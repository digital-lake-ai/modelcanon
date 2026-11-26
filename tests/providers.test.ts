import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseClaudeDeprecations } from "../src/providers/claude.js";
import { parseDeepSeekUpdatesHtml } from "../src/providers/deepseek.js";
import { parseGeminiDeprecations } from "../src/providers/gemini.js";
import { parseKimiDocs } from "../src/providers/kimi.js";
import { parseOpenAiDeprecations } from "../src/providers/openai.js";
import {
  extractDatedChangelogEvents,
  getProviderAdapters,
  ingestFullCatalog,
} from "../src/registry/providers.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("Provider registry and 5 official adapters", () => {
  it("registers exactly the 5 core ModelCanon providers", () => {
    expect(getProviderAdapters().map((p) => p.id)).toEqual([
      "gemini",
      "claude",
      "openai",
      "deepseek",
      "kimi",
    ]);
  });

  it("parses Gemini Markdoc deprecation tables", () => {
    const parsed = parseGeminiDeprecations(
      fixture("gemini-deprecations.sample.md"),
      "2026-11-26T08:00:00Z",
      new Date("2026-11-26T08:00:00Z"),
    );
    const pro25 = parsed.models.find((m) => m.canonical_id === "gemini-2.5-pro");
    expect(pro25?.status).toBe("deprecated");
    expect(pro25?.shutdown_date).toBe("2026-12-01");
    expect(pro25?.replacement_id).toBe("gemini-3.8-flash");
  });

  it("parses Claude deprecation tables and undated alias retirement notes", () => {
    const parsed = parseClaudeDeprecations(
      fixture("claude-deprecations.sample.md"),
      "2026-11-26T08:00:00Z",
    );
    const sonnetUndated = parsed.models.find((m) => m.canonical_id === "claude-sonnet-4-5");
    expect(sonnetUndated?.status).toBe("deprecated");
    expect(sonnetUndated?.shutdown_date).toBe("2026-11-30");
    expect(sonnetUndated?.replacement_id).toBe("claude-sonnet-5-5");

    const opus55 = parsed.models.find((m) => m.canonical_id === "claude-opus-5-5");
    expect(opus55?.status).toBe("active");
    expect(opus55?.shutdown_date).toBeNull();
  });

  it("parses OpenAI deprecation tables, DeepSeek updates HTML, and Kimi docs", () => {
    const openai = parseOpenAiDeprecations(
      fixture("openai-deprecations.sample.md"),
      "2026-11-26T08:00:00Z",
    );
    const gpt41 = openai.models.find((m) => m.canonical_id === "gpt-4.1-2025-04-14");
    expect(gpt41?.shutdown_date).toBe("2027-01-14");
    expect(gpt41?.replacement_id).toBe("gpt-6-luna");

    const deepseek = parseDeepSeekUpdatesHtml(
      fixture("deepseek-updates.sample.html"),
      "2026-11-26T08:00:00Z",
    );
    expect(deepseek.events[0]?.published_at).toBe("2026-11-13");
    expect(deepseek.models[0]?.canonical_id).toBe("deepseek-flash");

    const sanitizedDeepseek = parseDeepSeekUpdatesHtml(
      "<article><p>Date: 2026-11-13</p><h2>Safe title</h2><script>alert(1)</script><p>The deepseek-flash model supports &amp;lt;tag&amp;gt; cleanly in API.</p></article>",
      "2026-11-26T08:00:00Z",
    );
    expect(sanitizedDeepseek.events[0]?.agent_summary).not.toContain("alert(1)");
    expect(sanitizedDeepseek.events[0]?.agent_summary).toContain("&lt;tag&gt;");

    const kimi = parseKimiDocs(
      "- [Kimi K3.1 Pro](https://platform.kimi.ai/docs/guide/kimi-k3-1-pro-quickstart.md): Kimi K3.1 Pro (`kimi-k3.1-pro`) with 1M context.",
      "All K3 series models support a 1,048,576-token context window.",
      "2026-11-26T08:00:00Z",
    );
    expect(kimi.models.some((m) => m.canonical_id === "kimi-k3.1-pro")).toBe(true);
    expect(kimi.events.length).toBeGreaterThan(0);
  });

  it("extracts dated changelog events and merges full catalog offline", async () => {
    const chgEvents = extractDatedChangelogEvents(
      "## November 19, 2026\n\n* Released `gemini-4-neon` on the Gemini API for low-latency coding.",
      {
        provider: "gemini",
        sourceUrl: "https://ai.google.dev/gemini-api/docs/changelog.md.txt",
        detectedAt: "2026-11-26T08:00:00Z",
      },
    );
    expect(chgEvents).toHaveLength(1);
    expect(chgEvents[0].published_at).toBe("2026-11-19");
    expect(chgEvents[0].models_affected).toContain("gemini-4-neon");

    const fakeFetch: typeof fetch = async (input) => {
      const parsedUrl = new URL(String(input));
      if (parsedUrl.hostname === "models.dev") {
        return new Response(fixture("models-dev.sample.json"), { status: 200 });
      }
      if (
        parsedUrl.hostname === "raw.githubusercontent.com" &&
        parsedUrl.pathname.endsWith("/model_prices_and_context_window.json")
      ) {
        return new Response(fixture("litellm.sample.json"), { status: 200 });
      }
      if (parsedUrl.hostname === "models.litellm.ai" && parsedUrl.pathname === "/changelog.xml") {
        return new Response(fixture("litellm-rss.sample.xml"), { status: 200 });
      }
      if (
        parsedUrl.hostname === "ai.google.dev" &&
        parsedUrl.pathname.endsWith("/deprecations.md.txt")
      ) {
        return new Response(fixture("gemini-deprecations.sample.md"), { status: 200 });
      }
      if (
        parsedUrl.hostname === "platform.claude.com" &&
        parsedUrl.pathname.endsWith("/model-deprecations.md")
      ) {
        return new Response(fixture("claude-deprecations.sample.md"), { status: 200 });
      }
      if (
        parsedUrl.hostname === "developers.openai.com" &&
        parsedUrl.pathname.endsWith("/deprecations.md")
      ) {
        return new Response(fixture("openai-deprecations.sample.md"), { status: 200 });
      }
      if (parsedUrl.hostname === "api-docs.deepseek.com" && parsedUrl.pathname === "/updates") {
        return new Response(fixture("deepseek-updates.sample.html"), { status: 200 });
      }
      if (parsedUrl.hostname === "platform.kimi.ai" && parsedUrl.pathname === "/docs/llms.txt") {
        return new Response(
          "- [Kimi K3.1 Pro](https://platform.kimi.ai/docs/guide/kimi-k3-1-pro-quickstart.md): Kimi K3.1 Pro (`kimi-k3.1-pro`) 1M context.",
          { status: 200 },
        );
      }
      return new Response("", { status: 200 });
    };

    const result = await ingestFullCatalog({
      fetchImpl: fakeFetch,
      now: () => new Date("2026-11-26T08:00:00Z"),
    });
    const opus = result.snapshot.models.find((m) => m.canonical_id === "claude-opus-5-5");
    expect(opus?.context_window).toBe(1000000);
    expect(opus?.source_origin).toBe("live_verified");
  });
});
