import { fetchResource } from "../http/fetcher.js";
import type { ModelRecord, ProviderId } from "../schema/models.js";

export const MODELS_DEV_API_URL = "https://models.dev/api.json";

const MODELS_DEV_PROVIDER_MAP: Record<string, { provider: ProviderId; idFilter?: RegExp }> = {
  google: { provider: "gemini" },
  anthropic: { provider: "claude" },
  openai: { provider: "openai" },
  deepseek: { provider: "deepseek" },
  moonshotai: { provider: "kimi" },
  xai: { provider: "xai", idFilter: /^grok-/i },
  zai: { provider: "zai", idFilter: /^glm-/i },
  alibaba: { provider: "qwen", idFilter: /^(?:qwen|qwq)/i },
};

interface ModelsDevRawEntry {
  id?: string;
  name?: string;
  temperature?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  status?: string;
  release_date?: string;
  last_updated?: string;
  cost?: {
    input?: number;
    output?: number;
  };
  limit?: {
    context?: number;
    output?: number;
  };
  canonical_model_id?: string;
}

interface ModelsDevRawProvider {
  doc?: string;
  models?: Record<string, ModelsDevRawEntry>;
}

export interface ModelsDevEnricherResult {
  models: ModelRecord[];
  etag: string | null;
  lastModified: string | null;
  sha256: string | null;
  notModified: boolean;
}

export function isValidCatalogModelId(canonicalId: string): boolean {
  if (!canonicalId || /[:/\s]/.test(canonicalId)) return false;
  if (!/[-0-9]/.test(canonicalId)) return false;
  if (/\.(?:md|mdx|txt|html?|json|xml|ya?ml)$/i.test(canonicalId)) return false;
  if (/search-api/i.test(canonicalId)) return false;
  return true;
}

export function parseModelsDevPayload(
  rawJson: string,
  verifiedAt: string = new Date().toISOString(),
): ModelRecord[] {
  const parsed = JSON.parse(rawJson) as Record<string, ModelsDevRawProvider>;
  const records: ModelRecord[] = [];

  for (const [providerKey, mapping] of Object.entries(MODELS_DEV_PROVIDER_MAP)) {
    const providerBlock = parsed[providerKey];
    if (!providerBlock?.models) continue;

    const targetProvider = mapping.provider;
    const officialUrl =
      typeof providerBlock.doc === "string" && providerBlock.doc.startsWith("https://")
        ? providerBlock.doc
        : defaultProviderDocUrl(targetProvider);

    for (const [modelKey, entry] of Object.entries(providerBlock.models)) {
      const canonicalId = (entry.id || modelKey).trim();
      if (!isValidCatalogModelId(canonicalId)) continue;
      if (mapping.idFilter && !mapping.idFilter.test(canonicalId)) continue;

      const aliases = new Set<string>();
      if (entry.canonical_model_id && entry.canonical_model_id !== canonicalId) {
        aliases.add(entry.canonical_model_id);
      }

      const contextWindow = toPositiveIntOrNull(entry.limit?.context);
      const maxOutput = toPositiveIntOrNull(entry.limit?.output);
      const inputUsd = toNonNegativeNumberOrNull(entry.cost?.input);
      const outputUsd = toNonNegativeNumberOrNull(entry.cost?.output);

      records.push({
        canonical_id: canonicalId,
        aliases: [...aliases],
        provider: targetProvider,
        display_name: entry.name || undefined,
        status: normalizeCatalogStatus(entry.status),
        deprecation_date: null,
        shutdown_date: null,
        replacement_id: null,
        context_window: contextWindow,
        max_output_tokens: maxOutput,
        supports_temperature: typeof entry.temperature === "boolean" ? entry.temperature : null,
        supports_reasoning: typeof entry.reasoning === "boolean" ? entry.reasoning : null,
        supports_tool_call: typeof entry.tool_call === "boolean" ? entry.tool_call : null,
        pricing_per_1m:
          inputUsd !== null || outputUsd !== null
            ? { input_usd: inputUsd, output_usd: outputUsd }
            : null,
        api_constraints: entry.temperature === false ? ["temperature parameter unsupported"] : [],
        official_url: officialUrl,
        source_origin: "catalog_only",
        last_verified_at: verifiedAt,
      });
    }
  }

  return records;
}

export async function fetchModelsDevCatalog(options?: {
  etag?: string | null;
  lastModified?: string | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<ModelsDevEnricherResult> {
  const res = await fetchResource(MODELS_DEV_API_URL, {
    etag: options?.etag,
    lastModified: options?.lastModified,
    accept: "application/json",
    maxBytes: 12 * 1024 * 1024,
    timeoutMs: 10_000,
    fetchImpl: options?.fetchImpl,
  });

  if (res.notModified || res.body === null) {
    return {
      models: [],
      etag: res.etag,
      lastModified: res.lastModified,
      sha256: res.sha256,
      notModified: true,
    };
  }

  const verifiedAt = (options?.now ?? (() => new Date()))().toISOString();
  return {
    models: parseModelsDevPayload(res.body, verifiedAt),
    etag: res.etag,
    lastModified: res.lastModified,
    sha256: res.sha256,
    notModified: false,
  };
}

function normalizeCatalogStatus(rawStatus: string | undefined): ModelRecord["status"] {
  if (rawStatus === "deprecated") return "deprecated";
  if (rawStatus === "retired") return "retired";
  return "active";
}

function toPositiveIntOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function toNonNegativeNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function defaultProviderDocUrl(provider: ProviderId): string {
  switch (provider) {
    case "gemini":
      return "https://ai.google.dev/gemini-api/docs";
    case "claude":
      return "https://platform.claude.com/docs/en/release-notes/overview";
    case "openai":
      return "https://developers.openai.com/api/docs";
    case "deepseek":
      return "https://api-docs.deepseek.com/updates";
    case "kimi":
      return "https://platform.moonshot.ai/docs/pricing/chat";
    case "xai":
      return "https://docs.x.ai/developers/models.md";
    case "zai":
      return "https://docs.z.ai/guides/overview/pricing.md";
    case "qwen":
      return "https://www.alibabacloud.com/help/en/model-studio/models.md";
  }
}
