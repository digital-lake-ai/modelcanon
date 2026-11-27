import { describe, expect, it } from "vitest";
import { resolveModelMatchWithStrategy } from "../src/domain/normalize.js";
import type { ModelRecord, ProviderId } from "../src/schema/models.js";

function makeModel(
  canonicalId: string,
  provider: ProviderId,
  overrides: Partial<ModelRecord> = {},
): ModelRecord {
  return {
    canonical_id: canonicalId,
    aliases: [],
    provider,
    status: "active",
    deprecation_date: null,
    shutdown_date: null,
    replacement_id: null,
    context_window: 1000000,
    max_output_tokens: 65536,
    supports_temperature: true,
    supports_reasoning: true,
    supports_tool_call: true,
    pricing_per_1m: null,
    api_constraints: [],
    official_url: "https://example.com/models",
    source_origin: "live_verified",
    last_verified_at: "2026-11-27T08:00:00Z",
    ...overrides,
  };
}

describe("Agnostic model ID normalization, short-alias inference, and uniqueness", () => {
  const NOW = new Date("2026-11-27T08:00:00Z");
  const CATALOG: ModelRecord[] = [
    makeModel("gemini-4-argon", "gemini"),
    makeModel("gemini-4-neon", "gemini"),
    makeModel("gemini-3.8-flash", "gemini"),
    makeModel("gemini-3-flash-preview", "gemini"),
    makeModel("claude-opus-5-5", "claude"),
    makeModel("claude-opus-4-8", "claude"),
    makeModel("claude-sonnet-4-5-20250929", "claude", {
      aliases: ["claude-sonnet-4-5"],
      status: "deprecated",
    }),
    makeModel("gpt-6.2-astra", "openai"),
    makeModel("gpt-6-astra", "openai"),
    makeModel("gpt-5.4-mini", "openai"),
    makeModel("deepseek-flash", "deepseek"),
  ];

  it("classifies exact, normalized, family_inferred, and none matches deterministically", () => {
    expect(resolveModelMatchWithStrategy("claude-opus-5-5", CATALOG, NOW)).toMatchObject({
      model: { canonical_id: "claude-opus-5-5" },
      strategy: "exact",
    });

    expect(
      resolveModelMatchWithStrategy("google/gemini-3.8-flash-high (antigravity)", CATALOG, NOW),
    ).toMatchObject({
      model: { canonical_id: "gemini-3.8-flash" },
      strategy: "normalized",
    });

    expect(resolveModelMatchWithStrategy("gemini/argon", CATALOG, NOW)).toMatchObject({
      model: { canonical_id: "gemini-4-argon" },
      strategy: "family_inferred",
    });

    expect(resolveModelMatchWithStrategy("claude/opus (antigravity)", CATALOG, NOW)).toMatchObject({
      model: { canonical_id: "claude-opus-5-5" },
      strategy: "family_inferred",
    });

    expect(resolveModelMatchWithStrategy("openai/astra", CATALOG, NOW)).toMatchObject({
      model: { canonical_id: "gpt-6.2-astra" },
      strategy: "family_inferred",
    });

    expect(resolveModelMatchWithStrategy("deepseek/flash", CATALOG, NOW)).toMatchObject({
      model: { canonical_id: "deepseek-flash" },
      strategy: "normalized",
    });
  });

  it("rejects generic modifier tokens and ambiguous multi-lineage tokens", () => {
    for (const query of ["gemini/pro", "gemini/flash", "openai/mini", "gemini/preview"]) {
      expect(resolveModelMatchWithStrategy(query, CATALOG, NOW)).toEqual({
        model: null,
        strategy: "none",
      });
    }

    const multiLineageCatalog = [
      makeModel("gemini-4-solar", "gemini"),
      makeModel("gemma-4-solar", "gemini"),
    ];
    expect(resolveModelMatchWithStrategy("gemini/solar", multiLineageCatalog, NOW)).toEqual({
      model: null,
      strategy: "none",
    });
  });

  it("refuses unprefixed matches across distinct providers when duplicate canonical IDs exist", () => {
    const duplicateCatalog = [
      makeModel("shared-model-1", "openai"),
      makeModel("shared-model-1", "kimi"),
    ];
    expect(resolveModelMatchWithStrategy("shared-model-1", duplicateCatalog, NOW)).toEqual({
      model: null,
      strategy: "none",
    });
    expect(
      resolveModelMatchWithStrategy("openai/shared-model-1", duplicateCatalog, NOW),
    ).toMatchObject({
      model: { provider: "openai", canonical_id: "shared-model-1" },
      strategy: "exact",
    });
  });
});
