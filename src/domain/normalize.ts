import type { ModelRecord } from "../schema/models.js";
import { compareModelsForListing, MODIFIER_TOKENS, parseModelShape } from "./rank.js";

export const MATCH_STRATEGIES = ["exact", "normalized", "family_inferred", "none"] as const;
export type MatchStrategy = (typeof MATCH_STRATEGIES)[number];

const KNOWN_VENDOR_PREFIXES = [
  "google/",
  "vertex/",
  "vertexai/",
  "vertex_ai/",
  "anthropic/",
  "openai/",
  "deepseek/",
  "moonshot/",
  "moonshotai/",
  "models/",
  "gemini/",
  "claude/",
  "kimi/",
  "xai/",
];

const VENDOR_PREFIX_TO_PROVIDER: Record<string, string> = {
  "google/": "gemini",
  "vertex/": "gemini",
  "vertexai/": "gemini",
  "vertex_ai/": "gemini",
  "gemini/": "gemini",
  "anthropic/": "claude",
  "claude/": "claude",
  "openai/": "openai",
  "deepseek/": "deepseek",
  "moonshot/": "kimi",
  "moonshotai/": "kimi",
  "kimi/": "kimi",
  "xai/": "xai",
  "x-ai/": "xai",
  "zai/": "zai",
  "z-ai/": "zai",
  "zhipu/": "zai",
  "zhipuai/": "zai",
  "dashscope/": "qwen",
  "alibaba/": "qwen",
  "qwen/": "qwen",
};

const SHORT_ALIAS_PROVIDER_MAP: Record<string, string> = {
  gemini: "gemini",
  google: "gemini",
  claude: "claude",
  anthropic: "claude",
  openai: "openai",
  deepseek: "deepseek",
  kimi: "kimi",
  moonshot: "kimi",
  moonshotai: "kimi",
  xai: "xai",
  "x-ai": "xai",
  grok: "xai",
  zai: "zai",
  "z-ai": "zai",
  zhipu: "zai",
  zhipuai: "zai",
  glm: "zai",
  qwen: "qwen",
  alibaba: "qwen",
  dashscope: "qwen",
};

const MODEL_FAMILY_PREFIX_REGEX =
  /^(?:gemini-|gemma-|genie-|claude-|gpt-|chatgpt-|codex-|o1|o3|o4|deepseek-|kimi-|moonshot-)/;

const KNOWN_FAMILY_SEGMENT = new Set(["gemini", "claude", "gpt", "deepseek", "kimi", "moonshot"]);

export function stripVendorPrefix(rawId: string): string {
  const lower = rawId.trim().toLowerCase();
  for (const prefix of KNOWN_VENDOR_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return lower.slice(prefix.length);
    }
  }
  return lower;
}

export function stripDateSuffix(id: string): string {
  return id.replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "");
}

function inferVendorPrefixProvider(rawTrimmedLower: string): string | null {
  for (const [prefix, provider] of Object.entries(VENDOR_PREFIX_TO_PROVIDER)) {
    if (rawTrimmedLower.startsWith(prefix)) {
      return provider;
    }
  }
  return null;
}

function selectUniqueProviderMatch(matches: readonly ModelRecord[]): ModelRecord | null {
  if (matches.length === 0) return null;
  const distinctProviders = new Set(matches.map((m) => m.provider));
  return distinctProviders.size === 1 ? matches[0] : null;
}

function findDirectOrAliasMatch(
  rawTrimmedLower: string,
  models: readonly ModelRecord[],
): { model: ModelRecord; strategy: "exact" | "normalized" } | null {
  const hintedProvider = inferVendorPrefixProvider(rawTrimmedLower);
  const pool = hintedProvider
    ? models.filter((m) => (m.provider as string) === hintedProvider)
    : models;
  const searchPool = hintedProvider ? pool : models;

  const withoutPrefix = stripVendorPrefix(rawTrimmedLower);
  const withoutDate = stripDateSuffix(withoutPrefix);

  // 1. Exact canonical_id match (raw or prefix-stripped)
  const exactCanonicalMatches = searchPool.filter((candidate) => {
    const canon = candidate.canonical_id.toLowerCase();
    return canon === rawTrimmedLower || canon === withoutPrefix;
  });
  const uniqueCanonical = selectUniqueProviderMatch(exactCanonicalMatches);
  if (uniqueCanonical) {
    return { model: uniqueCanonical, strategy: "exact" };
  }
  if (exactCanonicalMatches.length > 1) return null;

  // 2. Exact alias match
  const exactAliasMatches = searchPool.filter((candidate) =>
    candidate.aliases.some((alias) => {
      const lowerAlias = alias.toLowerCase();
      return lowerAlias === rawTrimmedLower || lowerAlias === withoutPrefix;
    }),
  );
  const uniqueAlias = selectUniqueProviderMatch(exactAliasMatches);
  if (uniqueAlias) {
    return { model: uniqueAlias, strategy: "exact" };
  }
  if (exactAliasMatches.length > 1) return null;

  // 3. Date-suffix-normalized match (dated <-> undated alias)
  const dateNormalizedMatches = searchPool.filter((candidate) => {
    const canonBase = stripDateSuffix(stripVendorPrefix(candidate.canonical_id));
    if (canonBase === withoutDate) {
      return true;
    }
    return candidate.aliases.some(
      (alias) => stripDateSuffix(stripVendorPrefix(alias)) === withoutDate,
    );
  });
  const uniqueDateMatch = selectUniqueProviderMatch(dateNormalizedMatches);
  if (uniqueDateMatch) {
    return { model: uniqueDateMatch, strategy: "normalized" };
  }

  return null;
}

function stripTrailingClientTag(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.endsWith(")")) return trimmed;
  const openIdx = trimmed.lastIndexOf("(");
  return openIdx > 0 ? trimmed.slice(0, openIdx).trim() : trimmed;
}

function normalizeHarnessNotation(rawTrimmedLower: string): string {
  const withoutTag = stripTrailingClientTag(rawTrimmedLower);
  const segments = withoutTag.split("/").filter(Boolean);
  if (segments.length >= 2) {
    const last = segments[segments.length - 1];
    const prev = segments[segments.length - 2];
    if (MODEL_FAMILY_PREFIX_REGEX.test(last)) {
      return last;
    }
    if (KNOWN_FAMILY_SEGMENT.has(prev)) {
      return `${prev}-${last}`;
    }
    return stripVendorPrefix(last);
  }
  return stripVendorPrefix(withoutTag);
}

function isEffectiveActive(model: ModelRecord, now: Date): boolean {
  if (model.status !== "active") return false;
  if (model.shutdown_date && /^\d{4}-\d{2}-\d{2}$/.test(model.shutdown_date)) {
    const targetMs = Date.parse(`${model.shutdown_date}T00:00:00Z`);
    const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (Number.isFinite(targetMs) && targetMs <= todayUtcMs) {
      return false;
    }
  }
  return true;
}

function compareNonAlphabeticalRankKeys(a: ModelRecord, b: ModelRecord): number {
  const aVerified = a.source_origin === "live_verified" ? 0 : 1;
  const bVerified = b.source_origin === "live_verified" ? 0 : 1;
  if (aVerified !== bVerified) return aVerified - bVerified;

  const aLite = a.official_url.includes("BerriAI/litellm") ? 1 : 0;
  const bLite = b.official_url.includes("BerriAI/litellm") ? 1 : 0;
  if (aLite !== bLite) return aLite - bLite;

  const aShape = parseModelShape(a.canonical_id);
  const bShape = parseModelShape(b.canonical_id);

  const aHasGen = aShape.generation.length > 0 ? 0 : 1;
  const bHasGen = bShape.generation.length > 0 ? 0 : 1;
  if (aHasGen !== bHasGen) return aHasGen - bHasGen;

  const maxLen = Math.max(aShape.generation.length, bShape.generation.length);
  for (let i = 0; i < maxLen; i += 1) {
    const diff = (bShape.generation[i] ?? 0) - (aShape.generation[i] ?? 0);
    if (diff !== 0) return diff;
  }

  if (aShape.tierRank !== bShape.tierRank) {
    return aShape.tierRank - bShape.tierRank;
  }
  return aShape.segmentCount - bShape.segmentCount;
}

function inferSingleLineageShortAlias(
  rawTrimmedLower: string,
  models: readonly ModelRecord[],
  now: Date,
): ModelRecord | null {
  const withoutTag = stripTrailingClientTag(rawTrimmedLower);
  const segments = withoutTag.split("/").filter(Boolean);
  if (segments.length !== 2) return null;

  const targetProvider = SHORT_ALIAS_PROVIDER_MAP[segments[0]];
  const token = segments[1];
  if (!targetProvider || !/^[a-z]{3,}$/.test(token) || MODIFIER_TOKENS.has(token)) {
    return null;
  }

  const baseCandidates: Array<{ model: ModelRecord; lineageKey: string }> = [];
  for (const candidate of models) {
    if ((candidate.provider as string) !== targetProvider) continue;
    if (!isEffectiveActive(candidate, now)) continue;
    const idSegs = candidate.canonical_id.toLowerCase().split("-").filter(Boolean);
    if (!idSegs.includes(token)) continue;

    const shape = parseModelShape(candidate.canonical_id);
    if (shape.isSnapshot || shape.variantRank !== 0 || shape.isAuxiliary) continue;

    const lineageKey = shape.lineageSegments.filter((s) => !MODIFIER_TOKENS.has(s)).join("-");
    baseCandidates.push({ model: candidate, lineageKey });
  }

  if (baseCandidates.length === 0) return null;
  if (new Set(baseCandidates.map((c) => c.lineageKey)).size !== 1) return null;

  const ranked = baseCandidates
    .map(({ model }) => ({ model, effectiveStatus: "active" as const }))
    .sort(compareModelsForListing);

  if (
    ranked.length >= 2 &&
    compareNonAlphabeticalRankKeys(ranked[0].model, ranked[1].model) === 0
  ) {
    return null;
  }

  return ranked[0]?.model ?? null;
}

export function resolveModelMatchWithStrategy(
  rawModelId: string,
  models: readonly ModelRecord[],
  now: Date = new Date(),
): { model: ModelRecord | null; strategy: MatchStrategy } {
  const trimmed = rawModelId.trim().toLowerCase();
  if (!trimmed) {
    return { model: null, strategy: "none" };
  }

  const direct = findDirectOrAliasMatch(trimmed, models);
  if (direct) return direct;

  // 4. Exact agnostic harness normalization fallback (tag, provider/segment, effort suffix)
  const normalized = normalizeHarnessNotation(trimmed);
  if (normalized && normalized !== trimmed) {
    const fromNormalized = findDirectOrAliasMatch(normalized, models);
    if (fromNormalized) {
      return { model: fromNormalized.model, strategy: "normalized" };
    }
  }

  const strippedEffort = normalized.replace(/-(?:minimal|low|medium|high|xhigh|max)$/, "");
  if (strippedEffort && strippedEffort !== normalized) {
    const fromEffort = findDirectOrAliasMatch(strippedEffort, models);
    if (fromEffort) {
      return { model: fromEffort.model, strategy: "normalized" };
    }
  }

  // 5. Dynamic single-lineage <provider>/<token> resolution (rejecting ambiguous modifiers)
  const inferred = inferSingleLineageShortAlias(trimmed, models, now);
  if (inferred) {
    return { model: inferred, strategy: "family_inferred" };
  }

  return { model: null, strategy: "none" };
}

export function resolveModelMatch(
  rawModelId: string,
  models: readonly ModelRecord[],
  now: Date = new Date(),
): ModelRecord | null {
  return resolveModelMatchWithStrategy(rawModelId, models, now).model;
}
