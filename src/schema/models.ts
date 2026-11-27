import { z } from "zod";

export const PROVIDER_IDS = [
  "gemini",
  "claude",
  "openai",
  "deepseek",
  "kimi",
  "xai",
  "zai",
  "qwen",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const ProviderIdSchema = z.enum(PROVIDER_IDS);

export const ModelStatusSchema = z.enum(["active", "deprecated", "retired", "unknown"]);
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

export const DataSourceOriginSchema = z.enum(["live_verified", "bundled_seed", "catalog_only"]);
export type DataSourceOrigin = z.infer<typeof DataSourceOriginSchema>;

export const EventCategorySchema = z.enum([
  "new_model",
  "deprecation",
  "breaking_change",
  "pricing",
]);
export type EventCategory = z.infer<typeof EventCategorySchema>;

export const EventSeveritySchema = z.enum(["info", "warning", "critical"]);
export type EventSeverity = z.infer<typeof EventSeveritySchema>;

export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

export const HttpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) =>
      (value.startsWith("https://") || value.startsWith("http://")) && !value.includes("]("),
    "Must be a clean HTTP(S) URL without Markdown link syntax",
  );

export const PricingPer1MSchema = z.object({
  input_usd: z.number().nonnegative().nullable(),
  output_usd: z.number().nonnegative().nullable(),
});
export type PricingPer1M = z.infer<typeof PricingPer1MSchema>;

export const ModelRecordSchema = z.object({
  canonical_id: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  provider: ProviderIdSchema,
  display_name: z.string().min(1).optional(),
  status: ModelStatusSchema,
  deprecation_date: z.string().nullable(),
  shutdown_date: z.string().nullable(),
  replacement_id: z.string().nullable(),
  context_window: z.number().int().positive().nullable(),
  max_output_tokens: z.number().int().positive().nullable(),
  supports_temperature: z.boolean().nullable().default(null),
  supports_reasoning: z.boolean().nullable().default(null),
  supports_tool_call: z.boolean().nullable().default(null),
  pricing_per_1m: PricingPer1MSchema.nullable(),
  api_constraints: z.array(z.string()).default([]),
  official_url: HttpUrlSchema,
  source_origin: DataSourceOriginSchema,
  last_verified_at: z.string().min(1),
});
export type ModelRecord = z.infer<typeof ModelRecordSchema>;

export const UpdateEventSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  provider: ProviderIdSchema,
  category: EventCategorySchema,
  severity: EventSeveritySchema,
  confidence: ConfidenceLevelSchema,
  models_affected: z.array(z.string()),
  title: z.string().min(1),
  agent_summary: z.string().min(1),
  evidence_quote: z.string().min(1),
  source_url: HttpUrlSchema,
  published_at: z.string().min(1),
  effective_date: z.string().nullable().optional(),
  detected_at: z.string().min(1),
});
export type UpdateEvent = z.infer<typeof UpdateEventSchema>;

export const CatalogSnapshotSchema = z.object({
  schema_version: z.literal("1.0.0"),
  generated_at: z.string().min(1),
  stale: z.boolean().default(false),
  models: z.array(ModelRecordSchema),
  events: z.array(UpdateEventSchema),
});
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;
