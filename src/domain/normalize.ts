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
];

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

export function resolveModelMatch(
  rawModelId: string,
  models: readonly ModelRecord[],
): ModelRecord | null {
  const trimmed = rawModelId.trim().toLowerCase();
  if (!trimmed) return null;

  const withoutPrefix = stripVendorPrefix(trimmed);
  const withoutDate = stripDateSuffix(withoutPrefix);

  // 1. Exact canonical_id match (raw or prefix-stripped)
  for (const candidate of models) {
    const canon = candidate.canonical_id.toLowerCase();
    if (canon === trimmed || canon === withoutPrefix) {
      return candidate;
    }
  }

  // 2. Exact alias match
  for (const candidate of models) {
    for (const alias of candidate.aliases) {
      const lowerAlias = alias.toLowerCase();
      if (lowerAlias === trimmed || lowerAlias === withoutPrefix) {
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
