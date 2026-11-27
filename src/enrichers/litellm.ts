import { fetchResource } from "../http/fetcher.js";
import type { ModelRecord, ProviderId, UpdateEvent } from "../schema/models.js";
import { isValidCatalogModelId } from "./models-dev.js";

export const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
export const LITELLM_CHANGELOG_RSS_URL = "https://models.litellm.ai/changelog.xml";

const LITELLM_PROVIDER_MAP: Record<string, ProviderId> = {
  gemini: "gemini",
  anthropic: "claude",
  openai: "openai",
  deepseek: "deepseek",
  moonshot: "kimi",
};

const EXCLUDED_LITELLM_MODES = new Set(["search", "rerank", "ocr", "moderation"]);

interface LiteLlmRawModel {
  litellm_provider?: string;
  max_input_tokens?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  deprecation_date?: string;
  supports_reasoning?: boolean;
  supports_function_calling?: boolean;
  mode?: string;
}

export function parseLiteLlmPriceMap(
  rawJson: string,
  verifiedAt: string = new Date().toISOString(),
): ModelRecord[] {
  const parsed = JSON.parse(rawJson) as Record<string, LiteLlmRawModel>;
  const records: ModelRecord[] = [];

  for (const [rawKey, entry] of Object.entries(parsed)) {
    if (rawKey === "sample_spec" || !entry || typeof entry !== "object") continue;
    const provider = entry.litellm_provider
      ? LITELLM_PROVIDER_MAP[entry.litellm_provider.toLowerCase()]
      : undefined;
    if (!provider) continue;

    // Skip non-conversational modes (search, rerank, ocr, moderation) while preserving undefined
    if (typeof entry.mode === "string" && EXCLUDED_LITELLM_MODES.has(entry.mode.toLowerCase())) {
      continue;
    }

    // Skip third-party proxy keys (e.g., openrouter/, azure/, vertex_ai/)
    if (rawKey.includes("/") && !rawKey.startsWith(`${entry.litellm_provider}/`)) {
      continue;
    }

    const canonicalId = rawKey.includes("/") ? rawKey.slice(rawKey.indexOf("/") + 1) : rawKey;
    if (!isValidCatalogModelId(canonicalId)) {
      continue;
    }
    const aliases = rawKey !== canonicalId ? [rawKey] : [];

    const contextWindow = toPositiveIntOrNull(entry.max_input_tokens ?? entry.max_tokens);
    const maxOutput = toPositiveIntOrNull(entry.max_output_tokens);
    const inputUsd = toPerMillionUsd(entry.input_cost_per_token);
    const outputUsd = toPerMillionUsd(entry.output_cost_per_token);
    const deprecationDate =
      typeof entry.deprecation_date === "string" && entry.deprecation_date.trim() !== ""
        ? entry.deprecation_date.trim()
        : null;

    records.push({
      canonical_id: canonicalId,
      aliases,
      provider,
      status: deprecationDate ? "deprecated" : "active",
      deprecation_date: deprecationDate,
      shutdown_date: deprecationDate,
      replacement_id: null,
      context_window: contextWindow,
      max_output_tokens: maxOutput,
      supports_temperature: null,
      supports_reasoning:
        typeof entry.supports_reasoning === "boolean" ? entry.supports_reasoning : null,
      supports_tool_call:
        typeof entry.supports_function_calling === "boolean"
          ? entry.supports_function_calling
          : null,
      pricing_per_1m:
        inputUsd !== null || outputUsd !== null
          ? { input_usd: inputUsd, output_usd: outputUsd }
          : null,
      api_constraints: [],
      official_url: LITELLM_PRICES_URL,
      source_origin: "catalog_only",
      last_verified_at: verifiedAt,
    });
  }

  return records;
}

const THIRD_PARTY_PROXY_REGEX =
  /\b(azure|bedrock|vertex|sagemaker|baseten|together|fireworks|aihubmix|openrouter|huawei|groq|deepinfra|nebius|cloudflare|perplexity|databricks|ollama|vllm)\b/i;

const FIRST_PARTY_RSS_PLATFORMS: Record<string, ProviderId> = {
  "google ai studio": "gemini",
  google: "gemini",
  gemini: "gemini",
  anthropic: "claude",
  openai: "openai",
  deepseek: "deepseek",
  moonshot: "kimi",
  "moonshot ai": "kimi",
  moonshotai: "kimi",
  kimi: "kimi",
};

export function parseLiteLlmChangelogRss(
  rawXml: string,
  detectedAt: string = new Date().toISOString(),
  limit: number = 40,
): UpdateEvent[] {
  const events: UpdateEvent[] = [];
  const itemMatches = rawXml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  const todayIso = detectedAt.slice(0, 10);

  for (const match of itemMatches) {
    if (events.length >= limit) break;
    const itemXml = match[1];
    const title = decodeXmlEntities(extractTag(itemXml, "title"));
    const link = decodeXmlEntities(extractTag(itemXml, "link")) || LITELLM_CHANGELOG_RSS_URL;
    const pubDateRaw = decodeXmlEntities(extractTag(itemXml, "pubDate"));
    const description = decodeXmlEntities(extractTag(itemXml, "description"));
    const combined = `${title} ${description}`.toLowerCase();

    if (!title || THIRD_PARTY_PROXY_REGEX.test(combined)) continue;

    // Extract "<subject> [added ]on <platform>[: body]" linearly without backtracking regexes
    const colonIdx = title.indexOf(":");
    const head = (colonIdx >= 0 ? title.slice(0, colonIdx) : title).trim();
    const body = colonIdx >= 0 ? title.slice(colonIdx + 1).trim() : "";
    const onIdx = head.toLowerCase().lastIndexOf(" on ");
    if (onIdx < 0) continue;

    const platform = head
      .slice(onIdx + 4)
      .trim()
      .toLowerCase();
    const provider = FIRST_PARTY_RSS_PLATFORMS[platform];
    if (!provider || !matchesProviderText(combined, provider)) continue;

    const targetText = body || head;
    let category: UpdateEvent["category"];
    let severity: UpdateEvent["severity"];
    let effectiveDate: string | undefined;

    if (/\b(?:deprecat\w*|retir\w*|sunset\w*|shutdown|shut\s+down)\b/i.test(targetText)) {
      category = "deprecation";
      severity = "warning";
      effectiveDate = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(body)?.[1];
    } else if (/\b(?:cost\w*|pric(?:e\w*|ing))\b/i.test(targetText)) {
      category = "pricing";
      severity = "info";
    } else if (body === "" && /\b(?:added\s+on|models?\s+added)\b/i.test(head)) {
      category = "new_model";
      severity = "info";
    } else {
      continue;
    }

    const modelTokens = extractModelTokens(`${title} ${description}`);
    if (modelTokens.length === 0) continue;

    const rawDate = toIsoDate(pubDateRaw);
    const publishedAt = rawDate && rawDate <= todayIso ? rawDate : todayIso;
    const slugBase = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);

    events.push({
      id: `evt_litellm_${publishedAt.replace(/-/g, "")}_${slugBase}`,
      slug: `litellm-${slugBase}`,
      provider,
      category,
      severity,
      confidence: "low",
      models_affected: modelTokens,
      title,
      agent_summary: firstSentence(description || title, 220),
      evidence_quote: firstSentence(title, 200),
      source_url: link.startsWith("http") ? link : LITELLM_CHANGELOG_RSS_URL,
      published_at: publishedAt,
      ...(effectiveDate ? { effective_date: effectiveDate } : {}),
      detected_at: detectedAt,
    });
  }

  return events;
}

export async function fetchLiteLlmEnrichment(options?: {
  pricesEtag?: string | null;
  rssEtag?: string | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<{
  models: ModelRecord[];
  events: UpdateEvent[];
  pricesEtag: string | null;
  rssEtag: string | null;
}> {
  const nowIso = (options?.now ?? (() => new Date()))().toISOString();
  const [pricesRes, rssRes] = await Promise.allSettled([
    fetchResource(LITELLM_PRICES_URL, {
      etag: options?.pricesEtag,
      accept: "application/json",
      maxBytes: 10 * 1024 * 1024,
      timeoutMs: 10_000,
      fetchImpl: options?.fetchImpl,
    }),
    fetchResource(LITELLM_CHANGELOG_RSS_URL, {
      etag: options?.rssEtag,
      accept: "application/rss+xml, application/xml, text/xml",
      maxBytes: 3 * 1024 * 1024,
      timeoutMs: 10_000,
      fetchImpl: options?.fetchImpl,
    }),
  ]);

  const models =
    pricesRes.status === "fulfilled" && !pricesRes.value.notModified && pricesRes.value.body
      ? parseLiteLlmPriceMap(pricesRes.value.body, nowIso)
      : [];

  const events =
    rssRes.status === "fulfilled" && !rssRes.value.notModified && rssRes.value.body
      ? parseLiteLlmChangelogRss(rssRes.value.body, nowIso)
      : [];

  return {
    models,
    events,
    pricesEtag: pricesRes.status === "fulfilled" ? pricesRes.value.etag : null,
    rssEtag: rssRes.status === "fulfilled" ? rssRes.value.etag : null,
  };
}

function toPositiveIntOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function toPerMillionUsd(perToken: unknown): number | null {
  if (typeof perToken !== "number" || !Number.isFinite(perToken) || perToken < 0) return null;
  return Number((perToken * 1_000_000).toFixed(4));
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return regex.exec(xml)?.[1]?.trim() ?? "";
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
};

function unwrapCdata(input: string): string {
  let out = "";
  let pos = 0;
  while (pos < input.length) {
    const start = input.indexOf("<![CDATA[", pos);
    if (start === -1) {
      out += input.slice(pos);
      break;
    }
    out += input.slice(pos, start);
    const end = input.indexOf("]]>", start + 9);
    if (end === -1) {
      out += input.slice(start + 9);
      break;
    }
    out += input.slice(start + 9, end);
    pos = end + 3;
  }
  return out;
}

function decodeXmlEntities(input: string): string {
  return unwrapCdata(input)
    .replace(/&(amp|lt|gt|quot|#39);/gi, (match, name: string) => {
      return XML_ENTITIES[name.toLowerCase()] ?? match;
    })
    .trim();
}

function matchesProviderText(lower: string, provider: ProviderId): boolean {
  switch (provider) {
    case "gemini":
      return /\b(gemini|gemma|genie|google)\b/.test(lower);
    case "claude":
      return /\b(claude|anthropic)\b/.test(lower);
    case "openai":
      return /\b(gpt-|chatgpt-|codex-|openai|o1|o3|o4-mini)\b/.test(lower);
    case "deepseek":
      return /\bdeepseek\b/.test(lower);
    case "kimi":
      return /\b(kimi|moonshot)\b/.test(lower);
    case "xai":
      return /\b(grok|xai|x\.ai)\b/.test(lower);
    case "zai":
      return /\b(glm-|zai|z\.ai|zhipu)\b/.test(lower);
    case "qwen":
      return /\b(qwen|qwq|alibaba|dashscope)\b/.test(lower);
  }
}

function extractModelTokens(text: string): string[] {
  const sanitized = text.replace(/https?:\/\/\S+/gi, " ");
  const sourcePattern =
    "\\b(?:gemini-[a-z0-9._-]+|claude-[a-z0-9._-]+|gpt-[a-z0-9._-]+|chatgpt-[a-z0-9._-]+|codex-[a-z0-9._-]+|o1(?:-pro|-mini)?|o3(?:-pro|-mini)?|o4-mini|deepseek-[a-z0-9._-]+|kimi-[a-z0-9._-]+|moonshot-[a-z0-9._-]+)\\b";
  const exactLower = sanitized.match(new RegExp(sourcePattern, "g")) ?? [];
  const caseInsensitive = sanitized.match(new RegExp(sourcePattern, "gi")) ?? [];
  return [
    ...new Set(
      [...exactLower, ...caseInsensitive.map((m) => m.toLowerCase())].filter(isValidCatalogModelId),
    ),
  ].slice(0, 12);
}

function toIsoDate(raw: string): string | null {
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function firstSentence(text: string, maxLen: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const periodIdx = cleaned.search(/[.!?](\s|$)/);
  const sentence = periodIdx > 0 ? cleaned.slice(0, periodIdx + 1) : cleaned;
  return sentence.length <= maxLen ? sentence : `${sentence.slice(0, maxLen - 3)}...`;
}
