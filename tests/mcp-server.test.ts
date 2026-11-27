import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createModelCanonServer } from "../src/mcp/server.js";
import { type CatalogSnapshot, PROVIDER_IDS } from "../src/schema/models.js";

const SAMPLE_SNAPSHOT: CatalogSnapshot = {
  schema_version: "1.0.0",
  generated_at: "2026-11-26T08:00:00Z",
  stale: false,
  models: [
    {
      canonical_id: "claude-opus-5-5",
      aliases: ["anthropic/claude-opus-5-5"],
      provider: "claude",
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
    },
    {
      canonical_id: "claude-sonnet-4-5-20250929",
      aliases: ["claude-sonnet-4-5"],
      provider: "claude",
      status: "deprecated",
      deprecation_date: "2026-09-30",
      shutdown_date: "2026-11-30",
      replacement_id: "claude-sonnet-5-5",
      context_window: 200000,
      max_output_tokens: 64000,
      supports_temperature: true,
      supports_reasoning: true,
      supports_tool_call: true,
      pricing_per_1m: { input_usd: 3, output_usd: 15 },
      api_constraints: [],
      official_url: "https://platform.claude.com/docs/en/about-claude/model-deprecations.md",
      source_origin: "live_verified",
      last_verified_at: "2026-11-26T08:00:00Z",
    },
    {
      canonical_id: "claude-1.0",
      aliases: [],
      provider: "claude",
      status: "deprecated",
      deprecation_date: null,
      shutdown_date: "2024-11-06",
      replacement_id: "claude-opus-5-5",
      context_window: 100000,
      max_output_tokens: 4096,
      supports_temperature: true,
      supports_reasoning: false,
      supports_tool_call: false,
      pricing_per_1m: null,
      api_constraints: [],
      official_url: "https://platform.claude.com/docs/en/about-claude/model-deprecations.md",
      source_origin: "live_verified",
      last_verified_at: "2026-11-26T08:00:00Z",
    },
    {
      canonical_id: "gemini-3.8-flash",
      aliases: [],
      provider: "gemini",
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
      official_url: "https://ai.google.dev/gemini-api/docs",
      source_origin: "live_verified",
      last_verified_at: "2026-11-26T08:00:00Z",
    },
    {
      canonical_id: "gemini-4-argon",
      aliases: [],
      provider: "gemini",
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
      official_url: "https://ai.google.dev/gemini-api/docs",
      source_origin: "live_verified",
      last_verified_at: "2026-11-26T08:00:00Z",
    },
  ],
  events: [
    {
      id: "evt_claude_dep_sonnet_4_5",
      slug: "claude-sonnet-4-5-retirement",
      provider: "claude",
      category: "deprecation",
      severity: "warning",
      confidence: "high",
      models_affected: ["claude-sonnet-4-5-20250929", "claude-sonnet-4-5"],
      title: "claude-sonnet-4-5-20250929 scheduled for retirement on 2026-11-30",
      agent_summary:
        "claude-sonnet-4-5-20250929 retirement date is 2026-11-30; recommended replacement: claude-sonnet-5-5.",
      evidence_quote: "| November 30, 2026 | claude-sonnet-4-5-20250929 | claude-sonnet-5-5 |",
      source_url: "https://platform.claude.com/docs/en/about-claude/model-deprecations.md",
      published_at: "2026-09-30",
      effective_date: "2026-11-30",
      detected_at: "2026-11-26T08:00:00Z",
    },
    {
      id: "evt_future_noise",
      slug: "future-noise",
      provider: "gemini",
      category: "deprecation",
      severity: "warning",
      confidence: "high",
      models_affected: ["gemini-3.8-flash"],
      title: "Future announcement should be bounded by days filter",
      agent_summary: "Future notice test item.",
      evidence_quote: "Future notice",
      source_url: "https://ai.google.dev/gemini-api/docs",
      published_at: "2028-05-14",
      detected_at: "2026-11-26T08:00:00Z",
    },
  ],
};

describe("ModelCanon MCP Server over official SDK InMemoryTransport", () => {
  it("lists 3 read-only tools with outputSchema and serves structuredContent", async () => {
    const fixedNow = () => new Date("2026-11-26T08:00:00Z");
    const server = createModelCanonServer({
      getSnapshot: async () => SAMPLE_SNAPSHOT,
      now: fixedNow,
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const listedTools = await client.listTools();
      expect(listedTools.tools.map((t) => t.name)).toEqual([
        "audit_model_id",
        "get_latest_updates",
        "list_active_models",
      ]);
      for (const tool of listedTools.tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.outputSchema).toBeDefined();
        expect(tool.title).toMatch(/^ModelCanon [A-Z][a-z]+: /);
        expect(tool.description).toContain("Use when");
        expect(tool.description).toContain("Not for");
        if (tool.name === "get_latest_updates" || tool.name === "list_active_models") {
          const props = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
          expect(props.provider?.enum).toEqual(["all", ...PROVIDER_IDS]);
        }
      }

      const sonnetAudit = await client.callTool({
        name: "audit_model_id",
        arguments: { model_id: "anthropic/claude-sonnet-4-5" },
      });
      const sonnetStruct = sonnetAudit.structuredContent as Record<string, unknown>;
      expect(sonnetStruct.status).toBe("deprecated");
      expect(sonnetStruct.match_strategy).toBe("exact");
      expect(sonnetStruct.shutdown_date).toBe("2026-11-30");
      expect(sonnetStruct.replacement_id).toBe("claude-sonnet-5-5");
      expect(sonnetStruct.days_until_shutdown).toBe(4);

      const unknownAudit = await client.callTool({
        name: "audit_model_id",
        arguments: { model_id: "nonexistent-model-999" },
      });
      const unknownStruct = unknownAudit.structuredContent as Record<string, unknown>;
      expect(unknownStruct.status).toBe("unknown");
      expect(unknownStruct.match_strategy).toBe("none");

      const updates = await client.callTool({
        name: "get_latest_updates",
        arguments: { provider: "claude", category: "deprecation" },
      });
      const updatesStruct = updates.structuredContent as {
        total_returned: number;
        updates: Array<{ effective_date: string | null }>;
      };
      expect(updatesStruct.total_returned).toBe(1);
      expect(updatesStruct.updates[0]?.effective_date).toBe("2026-11-30");

      const active = await client.callTool({
        name: "list_active_models",
        arguments: { provider: "claude" },
      });
      const activeModels = (active.structuredContent as { models: Array<{ canonical_id: string }> })
        .models;
      expect(activeModels.map((m) => m.canonical_id)).toEqual(["claude-opus-5-5"]);

      const resources = await client.listResources();
      expect(resources.resources.map((r) => r.uri)).toContain("modelcanon://catalog/summary");

      const upcomingRes = await client.readResource({
        uri: "modelcanon://deprecations/upcoming",
      });
      const upcomingList = JSON.parse(
        String(
          upcomingRes.contents[0] && "text" in upcomingRes.contents[0]
            ? upcomingRes.contents[0].text
            : "[]",
        ),
      ) as Array<{ canonical_id: string; status: string }>;
      expect(upcomingList.map((u) => u.canonical_id)).toEqual(["claude-sonnet-4-5-20250929"]);

      const harnessAudit = await client.callTool({
        name: "audit_model_id",
        arguments: { model_id: "gemini/3.8-flash-high (antigravity)" },
      });
      const harnessStruct = harnessAudit.structuredContent as Record<string, unknown>;
      expect(harnessStruct.canonical_id).toBe("gemini-3.8-flash");
      expect(harnessStruct.status).toBe("active");
      expect(harnessStruct.match_strategy).toBe("normalized");

      const inferredAudit = await client.callTool({
        name: "audit_model_id",
        arguments: { model_id: "gemini/argon" },
      });
      const inferredStruct = inferredAudit.structuredContent as Record<string, unknown>;
      expect(inferredStruct.canonical_id).toBe("gemini-4-argon");
      expect(inferredStruct.status).toBe("active");
      expect(inferredStruct.match_strategy).toBe("family_inferred");

      const ambiguousAudit = await client.callTool({
        name: "audit_model_id",
        arguments: { model_id: "gemini/flash" },
      });
      const ambiguousStruct = ambiguousAudit.structuredContent as Record<string, unknown>;
      expect(ambiguousStruct.status).toBe("unknown");
      expect(ambiguousStruct.match_strategy).toBe("none");

      const roundRobinAll = await client.callTool({
        name: "list_active_models",
        arguments: { provider: "all", limit: 2 },
      });
      const allProviders = (
        roundRobinAll.structuredContent as { models: Array<{ provider: string }> }
      ).models.map((m) => m.provider);
      expect(allProviders).toEqual(["gemini", "claude"]);

      const boundedUpdates = await client.callTool({
        name: "get_latest_updates",
        arguments: { days: 90 },
      });
      expect((boundedUpdates.structuredContent as Record<string, unknown>).total_returned).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
