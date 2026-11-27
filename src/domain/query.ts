import {
  type CatalogSnapshot,
  type EventCategory,
  type ModelRecord,
  PROVIDER_IDS,
  type ProviderId,
  type UpdateEvent,
} from "../schema/models.js";
import { resolveModelMatch } from "./normalize.js";
import { compareModelsForListing } from "./rank.js";

export interface AuditModelOutput {
  queried_id: string;
  canonical_id: string | null;
  provider: ProviderId | null;
  status: ModelRecord["status"];
  days_until_shutdown: number | null;
  deprecation_date: string | null;
  shutdown_date: string | null;
  replacement_id: string | null;
  context_window: number | null;
  max_output_tokens: number | null;
  supports_temperature: boolean | null;
  api_constraints: string[];
  official_url: string | null;
  source_origin: ModelRecord["source_origin"] | null;
  stale: boolean;
  last_verified_at: string;
}

export interface CompactUpdateItem {
  id: string;
  provider: ProviderId;
  category: EventCategory;
  severity: UpdateEvent["severity"];
  confidence: UpdateEvent["confidence"];
  models_affected: string[];
  title: string;
  agent_summary: string;
  source_url: string;
  published_at: string;
}

export interface ActiveModelItem {
  canonical_id: string;
  provider: ProviderId;
  status: ModelRecord["status"];
  context_window: number | null;
  max_output_tokens: number | null;
  pricing_per_1m: ModelRecord["pricing_per_1m"];
  supports_temperature: boolean | null;
  official_url: string;
}

export function computeDaysUntilUtcDate(
  isoDate: string | null,
  now: Date = new Date(),
): number | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }
  const targetMs = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(targetMs)) {
    return null;
  }
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((targetMs - todayUtcMs) / 86_400_000);
}

export function resolveEffectiveStatus(
  model: Pick<ModelRecord, "status" | "shutdown_date">,
  now: Date = new Date(),
): ModelRecord["status"] {
  if (model.status === "retired") {
    return "retired";
  }
  const days = computeDaysUntilUtcDate(model.shutdown_date, now);
  if (days !== null && days <= 0) {
    return "retired";
  }
  return model.status;
}

export function auditModelId(
  snapshot: CatalogSnapshot,
  modelId: string,
  now: Date = new Date(),
): AuditModelOutput {
  const matched = resolveModelMatch(modelId, snapshot.models);
  if (!matched) {
    return {
      queried_id: modelId,
      canonical_id: null,
      provider: null,
      status: "unknown",
      days_until_shutdown: null,
      deprecation_date: null,
      shutdown_date: null,
      replacement_id: null,
      context_window: null,
      max_output_tokens: null,
      supports_temperature: null,
      api_constraints: [],
      official_url: null,
      source_origin: null,
      stale: snapshot.stale,
      last_verified_at: snapshot.generated_at,
    };
  }

  const daysRemaining = computeDaysUntilUtcDate(matched.shutdown_date, now);
  const resolvedStatus = resolveEffectiveStatus(matched, now);

  return {
    queried_id: modelId,
    canonical_id: matched.canonical_id,
    provider: matched.provider,
    status: resolvedStatus,
    days_until_shutdown: daysRemaining,
    deprecation_date: matched.deprecation_date,
    shutdown_date: matched.shutdown_date,
    replacement_id: matched.replacement_id,
    context_window: matched.context_window,
    max_output_tokens: matched.max_output_tokens,
    supports_temperature: matched.supports_temperature,
    api_constraints: matched.api_constraints,
    official_url: matched.official_url,
    source_origin: matched.source_origin,
    stale: snapshot.stale,
    last_verified_at: matched.last_verified_at,
  };
}

const CONFIDENCE_RANK: Record<UpdateEvent["confidence"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const SEVERITY_RANK: Record<UpdateEvent["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function getLatestUpdates(
  snapshot: CatalogSnapshot,
  filters: {
    provider?: ProviderId | "all";
    days?: number;
    category?: EventCategory | "all";
    limit?: number;
  } = {},
  now: Date = new Date(),
): { stale: boolean; total_returned: number; updates: CompactUpdateItem[] } {
  const provider = filters.provider ?? "all";
  const category = filters.category ?? "all";
  const limit = Math.min(Math.max(filters.limit ?? 15, 1), 50);
  const minTimestamp =
    typeof filters.days === "number" && filters.days > 0
      ? now.getTime() - filters.days * 86_400_000
      : null;
  const todayEndUtcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    23,
    59,
    59,
    999,
  );

  const filtered = snapshot.events
    .filter((evt) => {
      if (provider !== "all" && evt.provider !== provider) return false;
      if (category !== "all" && evt.category !== category) return false;
      if (minTimestamp !== null) {
        const pubMs = Date.parse(`${evt.published_at}T00:00:00Z`);
        if (!Number.isFinite(pubMs) || pubMs < minTimestamp || pubMs > todayEndUtcMs) {
          return false;
        }
      }
      return true;
    })
    .sort(
      (a, b) =>
        b.published_at.localeCompare(a.published_at) ||
        (a.id.startsWith("evt_litellm_") ? 1 : 0) - (b.id.startsWith("evt_litellm_") ? 1 : 0) ||
        CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.provider.localeCompare(b.provider) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit)
    .map((evt) => ({
      id: evt.id,
      provider: evt.provider,
      category: evt.category,
      severity: evt.severity,
      confidence: evt.confidence,
      models_affected: evt.models_affected,
      title: evt.title,
      agent_summary: evt.agent_summary,
      source_url: evt.source_url,
      published_at: evt.published_at,
    }));

  return {
    stale: snapshot.stale,
    total_returned: filtered.length,
    updates: filtered,
  };
}

export function listActiveModels(
  snapshot: CatalogSnapshot,
  filters: {
    provider?: ProviderId | "all";
    includeDeprecated?: boolean;
    limit?: number;
  } = {},
  now: Date = new Date(),
): { stale: boolean; total_returned: number; models: ActiveModelItem[] } {
  const provider = filters.provider ?? "all";
  const includeDeprecated = filters.includeDeprecated ?? false;
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

  const ranked = snapshot.models
    .map((model) => ({ model, effectiveStatus: resolveEffectiveStatus(model, now) }))
    .filter(({ model, effectiveStatus }) => {
      if (provider !== "all" && model.provider !== provider) return false;
      if (effectiveStatus === "active") return true;
      return includeDeprecated && effectiveStatus === "deprecated";
    })
    .sort(compareModelsForListing);

  const ordered = provider === "all" ? interleaveByProvider(ranked) : ranked;

  const items = ordered.slice(0, limit).map(({ model, effectiveStatus }) => ({
    canonical_id: model.canonical_id,
    provider: model.provider,
    status: effectiveStatus,
    context_window: model.context_window,
    max_output_tokens: model.max_output_tokens,
    pricing_per_1m: model.pricing_per_1m,
    supports_temperature: model.supports_temperature,
    official_url: model.official_url,
  }));

  return {
    stale: snapshot.stale,
    total_returned: items.length,
    models: items,
  };
}

function interleaveByProvider<T extends { model: ModelRecord }>(entries: readonly T[]): T[] {
  const buckets = new Map<ProviderId, T[]>();
  for (const id of PROVIDER_IDS) {
    buckets.set(id, []);
  }
  for (const entry of entries) {
    const bucket = buckets.get(entry.model.provider);
    if (bucket) {
      bucket.push(entry);
    }
  }

  const out: T[] = [];
  let idx = 0;
  while (out.length < entries.length) {
    let addedInRound = false;
    for (const id of PROVIDER_IDS) {
      const item = buckets.get(id)?.[idx];
      if (item) {
        out.push(item);
        addedInRound = true;
      }
    }
    if (!addedInRound) break;
    idx += 1;
  }
  return out;
}
