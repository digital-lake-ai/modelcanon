import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listActiveModels } from "../src/domain/query.js";
import { compareModelsForListing, MODIFIER_TOKENS, parseModelShape } from "../src/domain/rank.js";
import type { CatalogSnapshot, ModelRecord, ProviderId } from "../src/schema/models.js";

function makeModel(canonicalId: string, provider: ProviderId): ModelRecord {
  return {
    canonical_id: canonicalId,
    aliases: [],
    provider,
    status: "active",
    deprecation_date: null,
    shutdown_date: null,
    replacement_id: null,
    context_window: 128000,
    max_output_tokens: 16384,
    supports_temperature: true,
    supports_reasoning: true,
    supports_tool_call: true,
    pricing_per_1m: null,
    api_constraints: [],
    official_url: "https://example.com/models",
    source_origin: "bundled_seed",
    last_verified_at: "2026-11-26T08:00:00Z",
  };
}

describe("Generational and base-model listing ranker", () => {
  it("strips date/build suffixes cleanly and extracts generation tuples in linear time", () => {
    expect(MODIFIER_TOKENS.has("pro")).toBe(true);
    expect(parseModelShape("gpt-4.1-2025-04-14")).toMatchObject({
      generation: [4, 1],
      isSnapshot: true,
      variantRank: 2,
    });
    expect(parseModelShape("claude-opus-5-5")).toMatchObject({
      generation: [5, 5],
      tierRank: 0,
      variantRank: 0,
      isSnapshot: false,
    });
    expect(parseModelShape("claude-opus-4-7-20260416")).toMatchObject({
      generation: [4, 7],
      tierRank: 0,
      variantRank: 2,
      isSnapshot: true,
    });
    expect(parseModelShape("deepseek-v4.1-flash-1017")).toMatchObject({
      generation: [4, 1],
      tierRank: 2,
      variantRank: 2,
      isSnapshot: true,
    });
    expect(parseModelShape("imagen-3.0-fast-generate-001")).toMatchObject({
      generation: [3, 0],
      isSnapshot: true,
      isAuxiliary: true,
    });
    expect(parseModelShape("gemini-live-2.5-flash-preview-native-audio-09-2025")).toMatchObject({
      generation: [2, 5],
      isSnapshot: true,
      variantRank: 2,
      isAuxiliary: true,
    });
  });

  it("orders cross-line generations and penalizes vertical, preview, and snapshot variants", () => {
    const ids = [
      makeModel("o3", "openai"),
      makeModel("gpt-6.2-sol-healthcare", "openai"),
      makeModel("o4-mini", "openai"),
      makeModel("gpt-6.2-astra-law", "openai"),
      makeModel("gpt-6.2-astra", "openai"),
      makeModel("gpt-6.2-sol", "openai"),
    ];
    const sorted = ids
      .map((model) => ({ model, effectiveStatus: "active" as const }))
      .sort(compareModelsForListing)
      .map((entry) => entry.model.canonical_id);
    expect(sorted).toEqual([
      "gpt-6.2-astra",
      "gpt-6.2-sol",
      "o4-mini",
      "o3",
      "gpt-6.2-astra-law",
      "gpt-6.2-sol-healthcare",
    ]);

    const deepseekSorted = [
      makeModel("deepseek-r1", "deepseek"),
      makeModel("deepseek-v4.1-flash-1017", "deepseek"),
      makeModel("deepseek-coder", "deepseek"),
      makeModel("deepseek-v4.1-flash", "deepseek"),
    ]
      .map((model) => ({ model, effectiveStatus: "active" as const }))
      .sort(compareModelsForListing)
      .map((entry) => entry.model.canonical_id);
    expect(deepseekSorted).toEqual([
      "deepseek-v4.1-flash",
      "deepseek-r1",
      "deepseek-v4.1-flash-1017",
      "deepseek-coder",
    ]);
  });

  it("ranks flagship base models first across all 5 providers in data/seed.json", () => {
    const seedPath = resolve(import.meta.dirname, "../data/seed.json");
    const seed = JSON.parse(readFileSync(seedPath, "utf8")) as CatalogSnapshot;
    const now = new Date("2026-11-26T20:00:00Z");

    const openaiTop = listActiveModels(seed, { provider: "openai", limit: 5 }, now).models.map(
      (m) => m.canonical_id,
    );
    expect(openaiTop[0]).toBe("gpt-6.2-astra");

    const claudeTop = listActiveModels(seed, { provider: "claude", limit: 5 }, now).models.map(
      (m) => m.canonical_id,
    );
    expect(claudeTop.slice(0, 3)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);

    const deepseekTop = listActiveModels(seed, { provider: "deepseek", limit: 5 }, now).models.map(
      (m) => m.canonical_id,
    );
    expect(deepseekTop[0]).toBe("deepseek-v4.1-flash");

    const kimiTop = listActiveModels(seed, { provider: "kimi", limit: 5 }, now).models.map(
      (m) => m.canonical_id,
    );
    expect(kimiTop).toEqual(["kimi-k3.1-pro", "kimi-k3", "kimi-k3.1-pro-highspeed"]);

    const geminiTop = listActiveModels(seed, { provider: "gemini", limit: 5 }, now).models.map(
      (m) => m.canonical_id,
    );
    expect(geminiTop[0]).toBe("gemini-4-argon");
  });
});
