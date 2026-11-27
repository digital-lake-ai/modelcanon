import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MATCH_STRATEGIES } from "../domain/normalize.js";
import { auditModelId, getLatestUpdates, listActiveModels } from "../domain/query.js";
import {
  type CatalogSnapshot,
  ConfidenceLevelSchema,
  DataSourceOriginSchema,
  EventCategorySchema,
  EventSeveritySchema,
  ModelStatusSchema,
  PROVIDER_IDS,
  PricingPer1MSchema,
  ProviderIdSchema,
} from "../schema/models.js";

export type SnapshotProviderFn = () => Promise<CatalogSnapshot>;

const AuditModelInputShape = {
  model_id: z
    .string()
    .min(1)
    .describe(
      "AI model identifier to inspect, with or without vendor prefix or date suffix (examples: 'claude-opus-5-5', 'anthropic/claude-sonnet-4-5', 'gemini-2.5-pro', 'gpt-4.1').",
    ),
};

const AuditModelOutputShape = {
  queried_id: z.string(),
  canonical_id: z.string().nullable(),
  provider: ProviderIdSchema.nullable(),
  status: ModelStatusSchema,
  match_strategy: z
    .enum(MATCH_STRATEGIES)
    .describe(
      "How the queried identifier matched the catalog: 'exact', 'normalized', 'family_inferred', or 'none'.",
    ),
  days_until_shutdown: z.number().int().nullable(),
  deprecation_date: z.string().nullable(),
  shutdown_date: z.string().nullable(),
  replacement_id: z.string().nullable(),
  context_window: z.number().int().nullable(),
  max_output_tokens: z.number().int().nullable(),
  supports_temperature: z.boolean().nullable(),
  api_constraints: z.array(z.string()),
  official_url: z.string().nullable(),
  source_origin: DataSourceOriginSchema.nullable(),
  stale: z.boolean(),
  last_verified_at: z.string(),
};

const LatestUpdatesInputShape = {
  provider: z
    .enum(["all", ...PROVIDER_IDS])
    .optional()
    .describe(
      "Filter updates by provider ('gemini', 'claude', 'openai', 'deepseek', 'kimi') or 'all' (default: 'all').",
    ),
  days: z
    .number()
    .int()
    .positive()
    .max(365)
    .optional()
    .describe("Only include updates published within the last N days (1-365; example: 30)."),
  category: z
    .enum(["all", "new_model", "deprecation", "breaking_change", "pricing"])
    .optional()
    .describe(
      "Filter updates by event category ('new_model', 'deprecation', 'breaking_change', 'pricing') or 'all' (default: 'all').",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe("Maximum number of compact update entries to return (1-50; default: 15)."),
};

const LatestUpdatesOutputShape = {
  stale: z.boolean(),
  total_returned: z.number().int(),
  updates: z.array(
    z.object({
      id: z.string(),
      provider: ProviderIdSchema,
      category: EventCategorySchema,
      severity: EventSeveritySchema,
      confidence: ConfidenceLevelSchema,
      models_affected: z.array(z.string()),
      title: z.string(),
      agent_summary: z.string(),
      source_url: z.string(),
      published_at: z.string(),
      effective_date: z
        .string()
        .nullable()
        .describe(
          "ISO-8601 date when a deprecation or retirement takes effect, or null when unspecified.",
        ),
    }),
  ),
};

const ListActiveModelsInputShape = {
  provider: z
    .enum(["all", ...PROVIDER_IDS])
    .optional()
    .describe(
      "Filter active models by provider ('gemini', 'claude', 'openai', 'deepseek', 'kimi') or 'all' (default: 'all').",
    ),
  include_deprecated: z
    .boolean()
    .optional()
    .describe(
      "Include models with status 'deprecated' alongside 'active' models (default: false).",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("Maximum number of models to return (1-200; default: 50)."),
};

const ListActiveModelsOutputShape = {
  stale: z.boolean(),
  total_returned: z.number().int(),
  models: z.array(
    z.object({
      canonical_id: z.string(),
      provider: ProviderIdSchema,
      status: ModelStatusSchema,
      context_window: z.number().int().nullable(),
      max_output_tokens: z.number().int().nullable(),
      pricing_per_1m: PricingPer1MSchema.nullable(),
      supports_temperature: z.boolean().nullable(),
      official_url: z.string(),
    }),
  ),
};

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function registerModelCanonTools(
  server: McpServer,
  getSnapshot: SnapshotProviderFn,
  now: () => Date = () => new Date(),
): void {
  server.registerTool(
    "audit_model_id",
    {
      title: "ModelCanon Audit: Verify model lifecycle status, shutdown date and replacement",
      description:
        "Inspect lifecycle status ('active', 'deprecated', 'retired', or 'unknown'), UTC days until shutdown, official replacement ID, parameter constraints, and context limits for a specific AI model identifier across Gemini, Claude, OpenAI, DeepSeek, and Kimi. Includes match_strategy ('exact', 'normalized', 'family_inferred', or 'none') to distinguish literal matches from inferred short aliases. Use when validating or updating a model ID in code or config. Not for listing all available models (use list_active_models) or browsing recent announcements (use get_latest_updates). Read-only and idempotent: requires no API keys, serves from local cache or bundled offline seed with stale=true when offline, and returns status='unknown' for unrecognized IDs.",
      inputSchema: AuditModelInputShape,
      outputSchema: AuditModelOutputShape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ model_id }) => {
      const snapshot = await getSnapshot();
      const result = auditModelId(snapshot, model_id, now());
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: { ...result },
      };
    },
  );

  server.registerTool(
    "get_latest_updates",
    {
      title: "ModelCanon Updates: Retrieve cited changelog and deprecation events",
      description:
        "Return compact, cited official changelog and deprecation events filtered by provider, category, or recency window. Use when checking recent model releases, breaking API changes, or upcoming retirements. Not for auditing one specific model ID (use audit_model_id) or fetching full pricing tables (use list_active_models). Read-only and idempotent: requires no API keys and falls back to the bundled offline seed with stale=true if upstream sources are unreachable.",
      inputSchema: LatestUpdatesInputShape,
      outputSchema: LatestUpdatesOutputShape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ provider, days, category, limit }) => {
      const snapshot = await getSnapshot();
      const result = getLatestUpdates(snapshot, { provider, days, category, limit }, now());
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: { ...result },
      };
    },
  );

  server.registerTool(
    "list_active_models",
    {
      title: "ModelCanon Catalog: List active models, context limits and token pricing",
      description:
        "List currently active (and optionally deprecated) model identifiers with context windows, output token limits, temperature support, and USD pricing per 1M tokens. Use when selecting a current model or comparing provider capabilities. Not for reading changelog prose (use get_latest_updates) or checking retirement dates of a single ID (use audit_model_id). Read-only and idempotent: requires no API keys and falls back cleanly to the bundled offline seed when offline.",
      inputSchema: ListActiveModelsInputShape,
      outputSchema: ListActiveModelsOutputShape,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ provider, include_deprecated, limit }) => {
      const snapshot = await getSnapshot();
      const result = listActiveModels(snapshot, {
        provider,
        includeDeprecated: include_deprecated,
        limit,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: { ...result },
      };
    },
  );
}
