import { describe, expect, it } from "vitest";
import {
  CatalogSnapshotSchema,
  HttpUrlSchema,
  ModelRecordSchema,
  PROVIDER_IDS,
  UpdateEventSchema,
} from "../src/schema/models.js";

describe("ModelCanon Zod schemas", () => {
  it("exposes all 8 tracked providers", () => {
    expect(PROVIDER_IDS).toEqual([
      "gemini",
      "claude",
      "openai",
      "deepseek",
      "kimi",
      "xai",
      "zai",
      "qwen",
    ]);
  });

  it("accepts a valid ModelRecord and rejects corrupted Markdown URLs", () => {
    const valid = ModelRecordSchema.parse({
      canonical_id: "claude-opus-5-5",
      aliases: ["anthropic/claude-opus-5-5"],
      provider: "claude",
      display_name: "Claude Opus 5.5",
      status: "active",
      deprecation_date: null,
      shutdown_date: null,
      replacement_id: null,
      context_window: 1000000,
      max_output_tokens: 128000,
      supports_temperature: false,
      supports_reasoning: true,
      supports_tool_call: true,
      pricing_per_1m: { input_usd: 15, output_usd: 75 },
      api_constraints: ["temperature parameter unsupported"],
      official_url: "https://platform.claude.com/docs/en/release-notes/overview.md",
      source_origin: "live_verified",
      last_verified_at: "2026-11-26T08:00:00Z",
    });

    expect(valid.canonical_id).toBe("claude-opus-5-5");
    expect(valid.context_window).toBe(1000000);

    expect(() =>
      HttpUrlSchema.parse(
        "[https://platform.claude.com/docs/en/release-notes/overview](https://platform.claude.com/docs/en/release-notes/overview)",
      ),
    ).toThrow();
    expect(() => HttpUrlSchema.parse("ftp://example.com/file")).toThrow();
  });

  it("validates UpdateEvent with confidence and clean source_url", () => {
    const event = UpdateEventSchema.parse({
      id: "evt_20261123_claude_opus_4_5_deprecation",
      slug: "claude-opus-4-5-deprecation",
      provider: "claude",
      category: "deprecation",
      severity: "warning",
      confidence: "high",
      models_affected: ["claude-opus-4-5-20251101", "claude-opus-4-5"],
      title: "Claude Opus 4.5 scheduled for retirement on January 22, 2027",
      agent_summary:
        "Claude Opus 4.5 (claude-opus-4-5-20251101 and claude-opus-4-5) retires on January 22, 2027 with claude-opus-5-5 as replacement.",
      evidence_quote:
        "| claude-opus-4-5-20251101 | Deprecated | November 23, 2026 | January 22, 2027 |",
      source_url: "https://platform.claude.com/docs/en/about-claude/model-deprecations.md",
      published_at: "2026-11-23",
      detected_at: "2026-11-26T08:00:00Z",
    });

    expect(event.confidence).toBe("high");

    const snapshot = CatalogSnapshotSchema.parse({
      schema_version: "1.0.0",
      generated_at: "2026-11-26T08:00:00Z",
      models: [],
      events: [event],
    });
    expect(snapshot.stale).toBe(false);
  });
});
