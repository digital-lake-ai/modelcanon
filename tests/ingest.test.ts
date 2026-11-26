import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLiteLlmChangelogRss, parseLiteLlmPriceMap } from "../src/enrichers/litellm.js";
import { parseModelsDevPayload } from "../src/enrichers/models-dev.js";
import { fetchNativeProviderModels } from "../src/enrichers/native-models.js";
import { FetchLimitError, fetchResource } from "../src/http/fetcher.js";
import type { CatalogSnapshot } from "../src/schema/models.js";
import { CatalogCacheStore } from "../src/store/cache.js";
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
      { OPENAI_API_KEY: "sk-test" },
      async () =>
        new Response(JSON.stringify({ data: [{ id: "gpt-6.2-astra" }] }), { status: 200 }),
    );
    expect(discovered).toEqual([
      {
        provider: "openai",
        modelIds: ["gpt-6.2-astra"],
        sourceUrl: "https://api.openai.com/v1/models",
      },
    ]);
  });
});
