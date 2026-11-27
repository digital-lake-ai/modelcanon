import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLiteLlmChangelogRss } from "../src/enrichers/litellm.js";
import { parseClaudeDeprecations } from "../src/providers/claude.js";
import { parseDeepSeekUpdatesHtml } from "../src/providers/deepseek.js";
import { parseGeminiDeprecations } from "../src/providers/gemini.js";
import { parseKimiDocs } from "../src/providers/kimi.js";
import { parseOpenAiDeprecations } from "../src/providers/openai.js";
import { parseXaiDocs } from "../src/providers/xai.js";
import { parseZaiDocs } from "../src/providers/zai.js";
import {
  extractDatedChangelogEvents,
  extractModelIds,
  getProviderAdapters,
  ingestFullCatalog,
} from "../src/registry/providers.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("Provider registry and 5 official adapters", () => {
  it("registers official ModelCanon provider adapters", () => {
    expect(getProviderAdapters().map((p) => p.id)).toEqual([
      "gemini",
      "claude",
      "openai",
      "deepseek",
      "kimi",
      "xai",
      "zai",
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
    const pro25Event = parsed.events.find((e) => e.models_affected.includes("gemini-2.5-pro"));
    expect(pro25Event?.published_at).toBe("2026-11-26");
    expect(pro25Event?.effective_date).toBe("2026-12-01");

    const distantGemini = parseGeminiDeprecations(
      "{% table %}\n* Model\n* Shutdown date\n* Recommended replacement\n---\n* `gemini-3.5-flash`\n* 2028-05-14\n* `gemini-4-neon`\n{% /table %}",
      "2026-11-26T08:00:00Z",
      new Date("2026-11-26T08:00:00Z"),
    );
    expect(distantGemini.models[0]?.shutdown_date).toBe("2028-05-14");
    expect(distantGemini.events).toHaveLength(0);
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
    expect(parsed.events.every((e) => e.published_at <= "2026-11-26")).toBe(true);

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
      "<article><p>Date: 2026-11-13</p><h2>Safe title</h2><script>alert(1)</script><p>The deepseek-v4-pro model replaces legacy models. The two legacy API model names, deepseek-chat and deepseek-reasoner, will be discontinued in three months (2026-07-24).</p></article>",
      "2026-11-26T08:00:00Z",
    );
    expect(
      sanitizedDeepseek.models.find((m) => m.canonical_id === "deepseek-v4-pro")?.authority,
    ).toBe("mention");
    const dsChat = sanitizedDeepseek.models.find((m) => m.canonical_id === "deepseek-chat");
    expect(dsChat?.authority).toBe("explicit");
    expect(dsChat?.status).toBe("retired");
    expect(dsChat?.shutdown_date).toBe("2026-07-24");

    const sanitizedEntityDeepseek = parseDeepSeekUpdatesHtml(
      "<article><p>Date: 2026-11-13</p><h2>Safe title</h2><script>alert(1)</script><p>The deepseek-flash model supports &amp;lt;tag&amp;gt; cleanly in API.</p></article>",
      "2026-11-26T08:00:00Z",
    );
    expect(sanitizedEntityDeepseek.events[0]?.agent_summary).not.toContain("alert(1)");
    expect(sanitizedEntityDeepseek.events[0]?.agent_summary).toContain("&lt;tag&gt;");

    const kimi = parseKimiDocs(
      "- [Kimi K3.1 Pro](https://platform.kimi.ai/docs/guide/kimi-k3-1-pro-quickstart.md): Kimi K3.1 Pro (`kimi-k3.1-pro`) with 1M context.\n- [Kimi API Docs](https://platform.kimi.ai/docs/guide/kimi-api.md): Guide.",
      "All K3 series models support a 1,048,576-token context window. Legacy `moonshot-v1-8k` (`262,144` tokens). October 31, 2026 notice.",
      "2026-11-26T08:00:00Z",
      [
        "## Multi-modal Model",
        "| Model Name | Description |",
        "| - | - |",
        "| `kimi-k3.1-pro` | Flagship 1M-token model. |",
        "",
        "## Deprecated Models",
        "| Model Name | Description |",
        "| - | - |",
        "| `kimi-k2.7-code` | Deprecation expected in late December 2026 |",
        "| `moonshot-v1-8k` | Deprecated |",
      ].join("\n"),
    );
    expect(kimi.models.some((m) => m.canonical_id === "kimi-k3.1-pro")).toBe(true);
    expect(kimi.models.some((m) => m.canonical_id.endsWith(".md"))).toBe(false);
    const k27 = kimi.models.find((m) => m.canonical_id === "kimi-k2.7-code");
    expect(k27?.status).toBe("deprecated");
    expect(k27?.shutdown_date).toBe("2026-12-31");
    expect(k27?.replacement_id).toBe("kimi-k3.1-pro");
    const moonshot = kimi.models.find((m) => m.canonical_id === "moonshot-v1-8k");
    expect(moonshot?.api_constraints).toEqual([]);
    expect(kimi.events.some((e) => e.id.startsWith("evt_kimi_doc_"))).toBe(false);
    expect(kimi.events.some((e) => e.id === "evt_kimi_dep_kimi-k2.7-code_20261231")).toBe(true);
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
      if (parsedUrl.hostname === "platform.kimi.ai" && parsedUrl.pathname === "/docs/models.md") {
        return new Response(
          "## Multi-modal Model\n| Model Name | Description |\n| - | - |\n| `kimi-k3.1-pro` | 1M context. |\n",
          { status: 200 },
        );
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

    // Mention-authority patch must not overwrite existing catalog shutdown_date or official_url
    const kimiFallback = await ingestFullCatalog({
      now: () => new Date("2026-11-26T08:00:00Z"),
      fetchImpl: async (input) => {
        const u = new URL(String(input));
        if (u.hostname === "raw.githubusercontent.com") {
          return new Response(
            JSON.stringify({
              "moonshot-v1-8k": {
                litellm_provider: "moonshot",
                deprecation_date: "2026-08-31",
                max_input_tokens: 8192,
              },
            }),
            { status: 200 },
          );
        }
        if (u.hostname === "platform.kimi.ai" && u.pathname === "/docs/llms.txt") {
          return new Response("Legacy moonshot-v1-8k reference.", { status: 200 });
        }
        return new Response("", { status: 404 });
      },
    });
    const moonshot = kimiFallback.snapshot.models.find((m) => m.canonical_id === "moonshot-v1-8k");
    expect(moonshot?.status).toBe("deprecated");
    expect(moonshot?.shutdown_date).toBe("2026-08-31");
    expect(moonshot?.official_url).toContain("litellm");
    expect(moonshot?.source_origin).toBe("catalog_only");
    expect(kimiFallback.snapshot.events.every((e) => e.published_at <= "2026-11-26")).toBe(true);

    const rssFiltered = parseLiteLlmChangelogRss(
      [
        "<rss><channel>",
        "<item><title>AIHubMix adds gpt-5.4</title><description>gpt-5.4 via AIHubMix</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
        "<item><title>GPT-5.4 Pro on GMI Cloud: Supports low reasoning effort disabled</title><description>gpt-5.4-pro</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
        "<item><title>GPT-5 Pro on Replicate: Supports low reasoning effort disabled</title><description>gpt-5-pro</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
        "<item><title>Kimi K3.1 Pro added on NVIDIA NIM</title><description>kimi-k3.1-pro</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
        "<item><title>GPT-5.4 on ChatGPT Subscription: Deprecation source updated</title><description>gpt-5.4</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
        "<item><title>Gemini 4 Argon on Vertex AI: Pricing updated</title><description>gemini-4-argon</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
        "<item><title>OpenAI GPT-5.4 support</title><description>Missing platform clause gpt-5.4</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
        "<item><title>GPT-5 Pro on OpenAI: Supports low reasoning effort disabled</title><description>gpt-5-pro parameter tweak</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
        "<item><title>GPT-5.4 added on OpenAI</title><description>Direct openai/gpt-5.4 model added</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
        "<item><title>Gemini 2.5 Flash on Google AI Studio: Output cost per image token flex price added</title><description>gemini-2.5-flash pricing</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
        "<item><title>Claude Opus 4.5 on Anthropic: Deprecation date added: 2027-01-22</title><description>claude-opus-4-5 deprecated</description><pubDate>Thu, 26 Nov 2026 04:00:00 GMT</pubDate></item>",
        "</channel></rss>",
      ].join(""),
      "2026-11-26T08:00:00Z",
    );
    expect(rssFiltered).toHaveLength(3);
    expect(rssFiltered[0]).toMatchObject({
      provider: "openai",
      category: "new_model",
      confidence: "low",
      models_affected: ["gpt-5.4"],
    });
    expect(rssFiltered[1]).toMatchObject({
      provider: "gemini",
      category: "pricing",
      models_affected: ["gemini-2.5-flash"],
    });
    expect(rssFiltered[2]).toMatchObject({
      provider: "claude",
      category: "deprecation",
      effective_date: "2027-01-22",
      models_affected: ["claude-opus-4-5"],
    });

    expect(
      extractModelIds("Use grok-4.7, glm-5.3, qwen4-max, qwq-plus, or the standalone word qwen.", {
        limit: Number.POSITIVE_INFINITY,
      }),
    ).toEqual(["grok-4.7", "glm-5.3", "qwen4-max", "qwq-plus"]);
    expect(
      extractModelIds("Gateway hosts deepseek-v4-pro alongside qwen3.6-plus and qwq-plus.", {
        allowedPrefixes: /^(?:qwen|qwq)/i,
      }),
    ).toEqual(["qwen3.6-plus", "qwq-plus"]);

    const xaiParsed = parseXaiDocs(
      [
        "| Model | Context | Input / 1M tokens |",
        "| --- | --- | --- |",
        "| grok-4.7 (< 200k prompt tokens) | 500k | $2.00 |",
        "| grok-4.7 (≥ 200k prompt tokens) | 500k | $4.00 |",
        "| Speech to Speech (grok-voice-2.0) — Deprecated | - | $0.08 / min |",
      ].join("\n"),
      [
        "## November",
        "### grok-build-0.1 end of life",
        "`grok-build-0.1` reached end of life on November 19, 2026.",
        "### grok-voice-transcribe-1.0 end of life",
        "All requests are routed to `grok-voice-transcribe-2.0` starting October 2, 2026.",
        "### Month only without year",
        "`grok-4.6` updated on November 3 without explicit year.",
      ].join("\n"),
      "2026-11-27T08:00:00Z",
    );
    const grok47 = xaiParsed.models.find((m) => m.canonical_id === "grok-4.7");
    expect(grok47?.status).toBe("active");
    expect(grok47?.api_constraints).toContain(
      "Long-context tier pricing applies at >= 200k prompt tokens",
    );
    expect(xaiParsed.models.find((m) => m.canonical_id === "grok-voice-2.0")?.status).toBe(
      "deprecated",
    );
    const grokBuild = xaiParsed.models.find((m) => m.canonical_id === "grok-build-0.1");
    expect(grokBuild?.status).toBe("retired");
    expect(grokBuild?.shutdown_date).toBe("2026-11-19");
    expect(
      xaiParsed.models.find((m) => m.canonical_id === "grok-voice-transcribe-1.0")?.replacement_id,
    ).toBe("grok-voice-transcribe-2.0");
    expect(xaiParsed.events).toHaveLength(2);

    const zaiParsed = parseZaiDocs(
      [
        "| Model | Input | Output |",
        "| :- | :- | :- |",
        "| GLM-5.3 | \\$1.4 | \\$4.4 |",
        "> | Model | Input | Output |",
        "> | :- | :- | :- |",
        "> | GLM-4.7-Flash | Free | Free |",
        "> | GLM-Image | \\$0.015 | - |",
      ].join("\n"),
      [
        "**2026-08-26**",
        "GLM-5.3-Flash",
        "* Native visual capabilities for UI coding workflows.",
      ].join("\n"),
      "2026-11-27T08:00:00Z",
    );
    expect(zaiParsed.models.map((m) => m.canonical_id)).toEqual([
      "glm-5.3",
      "glm-4.7-flash",
      "glm-5.3-flash",
    ]);
    expect(zaiParsed.events[0]).toMatchObject({
      provider: "zai",
      category: "new_model",
      published_at: "2026-08-26",
      models_affected: ["glm-5.3-flash"],
    });
  });
});
