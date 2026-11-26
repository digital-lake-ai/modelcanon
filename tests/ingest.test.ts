import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLiteLlmChangelogRss, parseLiteLlmPriceMap } from "../src/enrichers/litellm.js";
import { parseModelsDevPayload } from "../src/enrichers/models-dev.js";
import { fetchNativeProviderModels } from "../src/enrichers/native-models.js";
import { FetchLimitError, fetchResource } from "../src/http/fetcher.js";
import { ingestFullCatalog } from "../src/registry/providers.js";
import type { CatalogSnapshot } from "../src/schema/models.js";
import { CACHE_PACKAGE_VERSION, CatalogCacheStore } from "../src/store/cache.js";
import { getCacheDir } from "../src/store/paths.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("HTTP fetcher, atomic cache, and catalog enrichers", () => {
  it("handles 304 Not Modified and enforces maxBytes limit on GET", async () => {
    const res304 = await fetchResource("https://example.com/data.json", {
      etag: '"v1"',
      fetchImpl: async (_url, init) => {
        expect(init?.method).toBe("GET");
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers["If-None-Match"]).toBe('"v1"');
        return new Response(null, { status: 304, headers: { etag: '"v1"' } });
      },
    });
    expect(res304.notModified).toBe(true);

    await expect(
      fetchResource("https://example.com/huge.txt", {
        maxBytes: 10,
        fetchImpl: async () => new Response("0123456789ABCDEF", { status: 200 }),
      }),
    ).rejects.toBeInstanceOf(FetchLimitError);
  });

  it("writes atomic cache and falls back cleanly to memory or bundled seed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "modelcanon-cache-"));
    try {
      const cachePath = join(dir, "snapshot.json");
      const now = () => new Date("2026-11-26T08:00:00Z");
      const store = new CatalogCacheStore({ cacheFilePath: cachePath, now, ttlSeconds: 60 });

      const sampleSnapshot: CatalogSnapshot = {
        schema_version: "1.0.0",
        generated_at: "2026-11-26T08:00:00Z",
        stale: false,
        models: [],
        events: [],
      };

      const written = store.writeEnvelope(sampleSnapshot);
      expect(written.persistedToDisk).toBe(true);
      expect(store.readEnvelope()?.snapshot.generated_at).toBe("2026-11-26T08:00:00Z");

      const memoryOnly = new CatalogCacheStore({
        cacheFilePath: cachePath,
        offlineFallback: true,
        now,
      });
      const memWrite = memoryOnly.writeEnvelope(sampleSnapshot);
      expect(memWrite.persistedToDisk).toBe(false);
      expect(memoryOnly.readEnvelope()?.snapshot.schema_version).toBe("1.0.0");

      const resolved = await store.resolveSnapshot({
        revalidateBudgetMs: 20,
        refresh: async () => {
          throw new Error("offline");
        },
      });
      expect(resolved.schema_version).toBe("1.0.0");
      expect(resolved.stale).toBe(false);

      // Mismatched package_version envelope on disk is discarded
      writeFileSync(
        cachePath,
        JSON.stringify({
          schema_version: "1.0.0",
          package_version: "0.0.1-old",
          cached_at: "2026-11-26T08:00:00Z",
          ttl_seconds: 60,
          sources: {},
          snapshot: sampleSnapshot,
        }),
        "utf8",
      );
      const versionCheckStore = new CatalogCacheStore({ cacheFilePath: cachePath, now });
      expect(versionCheckStore.readEnvelope()).toBeNull();

      // Deduplicated concurrent refresh + background SWR persistence + failure cooldown
      let refreshCount = 0;
      const slowStore = new CatalogCacheStore({
        cacheFilePath: join(dir, "swr.json"),
        now,
        ttlSeconds: 3600,
        failureCooldownMs: 60_000,
      });
      const slowRefresh = async () => {
        refreshCount += 1;
        await new Promise((r) => setTimeout(r, 80));
        return { snapshot: sampleSnapshot, sources: {} };
      };
      const [r1, r2, r3] = await Promise.all([
        slowStore.resolveSnapshot({ revalidateBudgetMs: 15, refresh: slowRefresh }),
        slowStore.resolveSnapshot({ revalidateBudgetMs: 15, refresh: slowRefresh }),
        slowStore.resolveSnapshot({ revalidateBudgetMs: 15, refresh: slowRefresh }),
      ]);
      expect(refreshCount).toBe(1);
      expect(r1.stale).toBe(true);
      expect(r2.stale).toBe(true);
      expect(r3.stale).toBe(true);
      await slowStore.drain();
      const afterDrain = await slowStore.resolveSnapshot({ refresh: slowRefresh });
      expect(afterDrain.stale).toBe(false);
      expect(slowStore.readEnvelope()?.package_version).toBe(CACHE_PACKAGE_VERSION);

      // Failure cooldown prevents hammering unreachable upstreams
      let failCalls = 0;
      const cooldownStore = new CatalogCacheStore({
        cacheFilePath: join(dir, "cooldown.json"),
        now,
        failureCooldownMs: 60_000,
      });
      const failingRefresh = async () => {
        failCalls += 1;
        throw new Error("unreachable");
      };
      const f1 = await cooldownStore.resolveSnapshot({ refresh: failingRefresh });
      const f2 = await cooldownStore.resolveSnapshot({ refresh: failingRefresh });
      expect(f1.stale).toBe(true);
      expect(f2.stale).toBe(true);
      expect(failCalls).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("computes cross-platform cache dirs", () => {
    expect(getCacheDir({ LOCALAPPDATA: "C:\\Users\\Dev\\AppData\\Local" }, "win32")).toContain(
      "modelcanon",
    );
    expect(getCacheDir({ XDG_CACHE_HOME: "/tmp/xdg" }, "linux")).toBe("/tmp/xdg/modelcanon");
  });

  it("filters models.dev and LiteLLM exclusively to the 5 core providers", () => {
    const mdModels = parseModelsDevPayload(
      fixture("models-dev.sample.json"),
      "2026-11-26T08:00:00Z",
    );
    expect(mdModels).toHaveLength(1);
    expect(mdModels[0].canonical_id).toBe("claude-opus-5-5");
    expect(mdModels[0].context_window).toBe(1000000);
    expect(mdModels[0].supports_temperature).toBe(false);

    const ltModels = parseLiteLlmPriceMap(fixture("litellm.sample.json"), "2026-11-26T08:00:00Z");
    expect(ltModels).toHaveLength(1);
    expect(ltModels[0].canonical_id).toBe("gpt-4.1-2025-04-14");
    expect(ltModels[0].deprecation_date).toBe("2027-01-14");
    expect(ltModels[0].pricing_per_1m).toEqual({ input_usd: 2, output_usd: 8 });

    const filteredLt = parseLiteLlmPriceMap(
      JSON.stringify({
        search: { litellm_provider: "deepseek", mode: "search" },
        container: { litellm_provider: "openai" },
        "ft:gpt-3.5-turbo": { litellm_provider: "openai", mode: "chat" },
        "gpt-5-search-api": { litellm_provider: "openai", mode: "chat" },
        "codex-mini-latest": { litellm_provider: "openai" },
      }),
      "2026-11-26T08:00:00Z",
    );
    expect(filteredLt.map((m) => m.canonical_id)).toEqual(["codex-mini-latest"]);

    const rssEvents = parseLiteLlmChangelogRss(
      fixture("litellm-rss.sample.xml"),
      "2026-11-26T08:00:00Z",
    );
    expect(rssEvents).toHaveLength(1);
    expect(rssEvents[0].provider).toBe("claude");
    expect(rssEvents[0].models_affected).toContain("claude-opus-5-5");
  });

  it("skips native GET /models when API keys are absent and parses when present", async () => {
    expect(await fetchNativeProviderModels({})).toEqual([]);

    const discovered = await fetchNativeProviderModels(
      { OPENAI_API_KEY: "sk-test", GEMINI_API_KEY: "AIza-test-key" },
      async (input, init) => {
        const reqUrl = String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (new URL(reqUrl).hostname === "generativelanguage.googleapis.com") {
          expect(reqUrl).not.toContain("key=");
          expect(headers["x-goog-api-key"]).toBe("AIza-test-key");
          return new Response(JSON.stringify({ models: [{ name: "models/gemini-4-neon" }] }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ data: [{ id: "gpt-6.2-astra" }] }), { status: 200 });
      },
    );
    expect(discovered).toEqual([
      {
        provider: "gemini",
        modelIds: ["gemini-4-neon"],
        sourceUrl: "https://generativelanguage.googleapis.com/v1beta/models",
      },
      {
        provider: "openai",
        modelIds: ["gpt-6.2-astra"],
        sourceUrl: "https://api.openai.com/v1/models",
      },
    ]);
  });

  it("enforces HTTPS, blocks downgrade redirects, strips cross-origin secrets, and prevents XML double-unescaping", async () => {
    await expect(fetchResource("http://insecure.example.com/data.json")).rejects.toThrow(
      "Only HTTPS URLs are permitted",
    );

    await expect(
      fetchResource("https://api.example.com/start", {
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://downgrade.example.com/target" },
          }),
      }),
    ).rejects.toThrow("Only HTTPS URLs are permitted");

    const seenHeaders: Array<Record<string, string>> = [];
    const redirected = await fetchResource("https://origin-a.example.com/start", {
      headers: { Authorization: "Bearer secret-token", "x-api-key": "k-123" },
      fetchImpl: async (input, init) => {
        seenHeaders.push((init?.headers ?? {}) as Record<string, string>);
        if (new URL(String(input)).hostname === "origin-a.example.com") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://origin-b.example.com/final" },
          });
        }
        return new Response("ok", { status: 200 });
      },
    });
    expect(redirected.body).toBe("ok");
    expect(seenHeaders[0].Authorization).toBe("Bearer secret-token");
    expect(seenHeaders[1].Authorization).toBeUndefined();
    expect(seenHeaders[1]["x-api-key"]).toBeUndefined();

    const rss = parseLiteLlmChangelogRss(
      "<rss><channel><item><title>Claude Opus 5.5 added on Anthropic</title><description>&amp;lt;script&amp;gt; claude-opus-5-5</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item></channel></rss>",
      "2026-11-26T08:00:00Z",
    );
    expect(rss[0]?.agent_summary).toContain("&lt;script&gt;");
    expect(rss[0]?.agent_summary).not.toContain("<script>");
  });

  it("cross-checks evt_litellm_* models_affected against the catalog and never sends If-None-Match", async () => {
    const seenIfNoneMatch: string[] = [];
    const rssXml = [
      "<rss><channel>",
      "<item><title>4 models added on OpenAI</title><description>Added gpt-6, gpt-6.1, and gpt-6-astra-healthcare.</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
      "<item><title>Phantom model added on OpenAI</title><description>Added gpt-99-phantom only.</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
      "</channel></rss>",
    ].join("");

    const result = await ingestFullCatalog({
      now: () => new Date("2026-11-26T08:00:00Z"),
      previousSources: {
        "https://models.dev/api.json": { etag: '"v1-etag"', lastModified: null, sha256: null },
        "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json":
          { etag: '"v1-etag"', lastModified: null, sha256: null },
        "https://models.litellm.ai/changelog.xml": {
          etag: '"v1-etag"',
          lastModified: null,
          sha256: null,
        },
        "https://developers.openai.com/api/docs/deprecations.md": {
          etag: '"v1-etag"',
          lastModified: null,
          sha256: null,
        },
      },
      fetchImpl: async (input, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const ifNoneMatch = headers["If-None-Match"] ?? headers["if-none-match"];
        if (ifNoneMatch) {
          seenIfNoneMatch.push(`${String(input)} -> ${ifNoneMatch}`);
        }
        const u = new URL(String(input));
        if (u.hostname === "raw.githubusercontent.com") {
          return new Response(
            JSON.stringify({
              "gpt-6-astra-healthcare": {
                litellm_provider: "openai",
                max_input_tokens: 128000,
              },
            }),
            { status: 200 },
          );
        }
        if (u.hostname === "models.litellm.ai") {
          return new Response(rssXml, { status: 200 });
        }
        return new Response("", { status: 404 });
      },
    });

    expect(seenIfNoneMatch).toEqual([]);
    const rssEvents = result.snapshot.events.filter((e) => e.id.startsWith("evt_litellm_"));
    expect(rssEvents).toHaveLength(1);
    expect(rssEvents[0]?.models_affected).toEqual(["gpt-6-astra-healthcare"]);
  });
});
