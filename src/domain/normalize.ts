import type { ModelRecord } from "../schema/models.js";

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

function findDirectOrAliasMatch(
  rawTrimmedLower: string,
  models: readonly ModelRecord[],
): ModelRecord | null {
  const withoutPrefix = stripVendorPrefix(rawTrimmedLower);
  const withoutDate = stripDateSuffix(withoutPrefix);

  // 1. Exact canonical_id match (raw or prefix-stripped)
  for (const candidate of models) {
    const canon = candidate.canonical_id.toLowerCase();
    if (canon === rawTrimmedLower || canon === withoutPrefix) {
      return candidate;
    }
  }

  // 2. Exact alias match
  for (const candidate of models) {
    for (const alias of candidate.aliases) {
      const lowerAlias = alias.toLowerCase();
      if (lowerAlias === rawTrimmedLower || lowerAlias === withoutPrefix) {
        return candidate;
      }
    }
  }

  // 3. Date-suffix-normalized match (dated <-> undated alias)
  for (const candidate of models) {
    const canonBase = stripDateSuffix(stripVendorPrefix(candidate.canonical_id));
    if (canonBase === withoutDate) {
      return candidate;
    }
    for (const alias of candidate.aliases) {
      const aliasBase = stripDateSuffix(stripVendorPrefix(alias));
      if (aliasBase === withoutDate) {
        return candidate;
      }
    }
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

export function resolveModelMatch(
  rawModelId: string,
  models: readonly ModelRecord[],
): ModelRecord | null {
  const trimmed = rawModelId.trim().toLowerCase();
  if (!trimmed) return null;

  const direct = findDirectOrAliasMatch(trimmed, models);
  if (direct) return direct;

  // 4. Exact agnostic harness normalization fallback (tag, provider/segment, effort suffix)
  const normalized = normalizeHarnessNotation(trimmed);
  if (normalized && normalized !== trimmed) {
    const fromNormalized = findDirectOrAliasMatch(normalized, models);
    if (fromNormalized) return fromNormalized;
  }

  const strippedEffort = normalized.replace(/-(?:minimal|low|medium|high|xhigh|max)$/, "");
  if (strippedEffort && strippedEffort !== normalized) {
    return findDirectOrAliasMatch(strippedEffort, models);
  }

  return null;
}
