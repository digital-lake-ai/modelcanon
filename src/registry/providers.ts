import { fetchLiteLlmEnrichment } from "../enrichers/litellm.js";
import { fetchModelsDevCatalog } from "../enrichers/models-dev.js";
import { fetchNativeProviderModels } from "../enrichers/native-models.js";
import { claudeAdapter } from "../providers/claude.js";
import { deepseekAdapter } from "../providers/deepseek.js";
import { geminiAdapter } from "../providers/gemini.js";
import { kimiAdapter } from "../providers/kimi.js";
import { openaiAdapter } from "../providers/openai.js";
import { xaiAdapter } from "../providers/xai.js";
import { zaiAdapter } from "../providers/zai.js";
import type {
  CatalogSnapshot,
  ConfidenceLevel,
  EventCategory,
  EventSeverity,
  ModelRecord,
  ModelStatus,
  ProviderId,
  UpdateEvent,
} from "../schema/models.js";
import type { HttpCacheMetadata } from "../store/cache.js";

export interface ProviderModelPatch {
  canonical_id: string;
  provider: ProviderId;
  authority?: "explicit" | "mention";
  aliases?: string[];
  display_name?: string;
  status?: ModelStatus;
  deprecation_date?: string | null;
  shutdown_date?: string | null;
  replacement_id?: string | null;
  api_constraints?: string[];
  official_url: string;
}

export interface ProviderIngestionResult {
  provider: ProviderId;
  models: ProviderModelPatch[];
  events: UpdateEvent[];
  sources: Record<string, HttpCacheMetadata>;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly primaryUrls: readonly string[];
  ingest(options?: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
    previousSources?: Record<string, HttpCacheMetadata>;
  }): Promise<ProviderIngestionResult>;
}

export function getProviderAdapters(): readonly ProviderAdapter[] {
  return [
    geminiAdapter,
    claudeAdapter,
    openaiAdapter,
    deepseekAdapter,
    kimiAdapter,
    xaiAdapter,
    zaiAdapter,
  ];
}

export function getProviderAdapter(id: ProviderId): ProviderAdapter {
  const found = getProviderAdapters().find((adapter) => adapter.id === id);
  if (!found) {
    throw new Error(`Unknown provider adapter: ${id}`);
  }
  return found;
}

export interface ParsedTable {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export function parseGfmTables(markdown: string): ParsedTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: ParsedTable[] = [];
  let i = 0;

  while (i + 1 < lines.length) {
    const headerLine = lines[i].trim();
    const sepLine = lines[i + 1].trim();
    if (headerLine.startsWith("|") && /^\|[\s:|-]+\|?$/.test(sepLine)) {
      const headers = splitGfmRow(headerLine);
      const rows: Array<Record<string, string>> = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = splitGfmRow(lines[i].trim());
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = cells[idx] ?? "";
        });
        rows.push(row);
        i += 1;
      }
      tables.push({ headers, rows });
      continue;
    }
    i += 1;
  }
  return tables;
}

export function parseMarkdocTables(markdown: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const blocks = markdown.matchAll(/\{%\s*table\s*%\}([\s\S]*?)\{%\s*\/table\s*%\}/gi);

  for (const block of blocks) {
    const sections = block[1]
      .split(/\r?\n[ \t]*---[ \t]*\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sections.length < 2) continue;

    const headers = extractMarkdocRowCells(sections[0]);
    if (headers.length === 0) continue;

    const rows: Array<Record<string, string>> = [];
    for (const rowBlock of sections.slice(1)) {
      const cells = extractMarkdocRowCells(rowBlock);
      if (cells.length === 0) continue;
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = cells[idx] ?? "";
      });
      rows.push(row);
    }
    tables.push({ headers, rows });
  }

  return tables;
}

export function extractDatedChangelogEvents(
  markdown: string,
  opts: {
    provider: ProviderId;
    sourceUrl: string;
    detectedAt: string;
    limit?: number;
  },
): UpdateEvent[] {
  const limit = opts.limit ?? 20;
  const lines = markdown.split(/\r?\n/);
  const events: UpdateEvent[] = [];
  let currentDate: string | null = null;
  let buffer: string[] = [];

  const flushSection = () => {
    if (!currentDate || buffer.length === 0 || events.length >= limit) return;
    const rawSection = buffer.join(" ").replace(/\s+/g, " ").trim();
    const cleaned = stripMarkdownNoise(rawSection);
    if (cleaned.length < 20) return;

    const { category, severity, confidence } = classifyUpdateText(cleaned);
    const models = extractModelIds(rawSection);
    const summary = firstSentence(cleaned, 220);
    const quote = firstSentence(cleaned, 200);
    const slugTail = summary
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 44);

    events.push({
      id: `evt_${opts.provider}_${currentDate.replace(/-/g, "")}_${slugTail}`,
      slug: `${opts.provider}-${currentDate}-${slugTail}`,
      provider: opts.provider,
      category,
      severity,
      confidence,
      models_affected: models,
      title: firstSentence(cleaned, 90),
      agent_summary: summary,
      evidence_quote: quote,
      source_url: opts.sourceUrl,
      published_at: currentDate,
      detected_at: opts.detectedAt,
    });
  };

  for (const line of lines) {
    const headingMatch = /^#{2,3}\s+(.+?)(?:\s+\{%\s*id=[^%]+%\})?\s*$/.exec(line.trim());
    if (headingMatch) {
      const maybeDate = parseFlexibleDate(headingMatch[1]);
      if (maybeDate) {
        flushSection();
        currentDate = maybeDate;
        buffer = [];
        continue;
      }
    }
    if (currentDate) {
      buffer.push(line);
    }
  }
  flushSection();

  return events;
}

export function minIsoDate(a: string, b: string): string {
  return a <= b ? a : b;
}

export function parseFlexibleDate(raw: string): string | null {
  const cleaned = raw
    .replace(/\*\*/g, "")
    .replace(/\{%[\s\S]*?%\}/g, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^(n\/a|tba|to be announced|not sooner than)/i.test(cleaned)) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }
  if (!/\b20\d{2}\b/.test(cleaned)) {
    return null;
  }
  const timestamp = Date.parse(`${cleaned} UTC`);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

const BLOCK_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "li",
  "div",
  "section",
  "article",
  "br",
  "tr",
]);

export function stripHtmlToText(html: string, preserveBlockNewlines = false): string {
  const chunks: string[] = [];
  let pos = 0;

  while (pos < html.length) {
    const lt = html.indexOf("<", pos);
    if (lt === -1) {
      chunks.push(html.slice(pos));
      break;
    }
    if (lt > pos) {
      chunks.push(html.slice(pos, lt));
    }

    const gt = html.indexOf(">", lt + 1);
    if (gt === -1) {
      break;
    }

    const rawTag = html.slice(lt + 1, gt).trim();
    const tagLower = rawTag.replace(/^\//, "").split(/[\s/]/, 1)[0]?.toLowerCase() ?? "";

    if (!rawTag.startsWith("/") && (tagLower === "script" || tagLower === "style")) {
      const lowerRest = html.toLowerCase();
      const closeIdx = lowerRest.indexOf(`</${tagLower}`, gt + 1);
      if (closeIdx === -1) {
        break;
      }
      const closeEnd = html.indexOf(">", closeIdx);
      pos = closeEnd === -1 ? html.length : closeEnd + 1;
      chunks.push(" ");
      continue;
    }

    if (preserveBlockNewlines && BLOCK_TAGS.has(tagLower)) {
      chunks.push("\n");
    } else {
      chunks.push(" ");
    }
    pos = gt + 1;
  }

  return chunks
    .join("")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/gi, (match, name: string) => {
      return HTML_ENTITY_MAP[name.toLowerCase()] ?? match;
    })
    .replace(/\u200B/g, "");
}

export function stripMarkdownNoise(text: string): string {
  const noLinks = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\{%[\s\S]*?%\}/g, " ");
  return stripHtmlToText(noLinks, false).replace(/\s+/g, " ").trim();
}

export function extractModelIds(
  text: string,
  options?: { limit?: number; allowedPrefixes?: RegExp },
): string[] {
  const limit = options?.limit ?? 8;
  const sanitized = text.replace(/\[([^\]]*)\]\([^)]+\)/g, "$1").replace(/https?:\/\/\S+/gi, " ");
  const matches =
    sanitized.match(
      /\b(?:gemini-[a-z0-9._-]+|gemma-[a-z0-9._-]+|genie-\d+[a-z0-9._-]*|claude-[a-z0-9._-]+|gpt-[a-z0-9._-]+|chatgpt-[a-z0-9._-]+|codex-[a-z0-9._-]+|o1(?:-pro|-mini)?|o3(?:-pro|-mini)?|o4-mini|deepseek-[a-z0-9._-]+|kimi-[a-z0-9._-]+|moonshot-[a-z0-9._-]+|grok-[a-z0-9._-]+|glm-[a-z0-9._-]+|qwen(?:\d[a-z0-9._-]*|-[a-z0-9._-]+)|qwq-[a-z0-9._-]+)\b/gi,
    ) ?? [];
  const filtered = matches
    .map((m) => m.toLowerCase().replace(/[.,;:]+$/, ""))
    .filter(
      (id) =>
        id.length > 0 &&
        !/\.(?:md|mdx|txt|html?|json|xml|ya?ml|pdf|png|svg|js|ts|py)$/i.test(id) &&
        !/-(?:quickstart|guide|guides|overview|docs|doc|best-practice|best-practices|tutorial|faq|cli|api-key)$/i.test(
          id,
        ) &&
        !/^(?:kimi-api|kimi-vision-model|gemini-api|claude-code|glm-image|glm-ocr|grok-api|qwen-api)$/i.test(
          id,
        ) &&
        (!options?.allowedPrefixes || options.allowedPrefixes.test(id)),
    );
  const unique = [...new Set(filtered)];
  return Number.isFinite(limit) ? unique.slice(0, limit) : unique;
}

export function classifyUpdateText(text: string): {
  category: EventCategory;
  severity: EventSeverity;
  confidence: ConfidenceLevel;
} {
  const lower = text.toLowerCase();
  if (
    /\b(breaking|removed parameter|no longer accept|http 400|migration required|v1\/responses)\b/.test(
      lower,
    )
  ) {
    return { category: "breaking_change", severity: "critical", confidence: "medium" };
  }
  if (/\b(deprecat|retir|shutdown|shut down|automatically route|sunset)\b/.test(lower)) {
    return { category: "deprecation", severity: "warning", confidence: "high" };
  }
  if (/\b(pricing|price|per million|cost per|billing|rates)\b/.test(lower)) {
    return { category: "pricing", severity: "info", confidence: "medium" };
  }
  return { category: "new_model", severity: "info", confidence: "medium" };
}

export async function ingestFullCatalog(options?: {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  previousSources?: Record<string, HttpCacheMetadata>;
}): Promise<{ snapshot: CatalogSnapshot; sources: Record<string, HttpCacheMetadata> }> {
  const nowFn = options?.now ?? (() => new Date());
  const generatedAt = nowFn().toISOString();

  const [modelsDevRes, litellmRes, nativeRes, ...providerResults] = await Promise.all([
    fetchModelsDevCatalog({ fetchImpl: options?.fetchImpl, now: nowFn }).catch(() => null),
    fetchLiteLlmEnrichment({ fetchImpl: options?.fetchImpl, now: nowFn }).catch(() => null),
    fetchNativeProviderModels(options?.env, options?.fetchImpl).catch(() => []),
    ...getProviderAdapters().map((adapter) =>
      adapter
        .ingest({
          fetchImpl: options?.fetchImpl,
          now: nowFn,
          previousSources: options?.previousSources,
        })
        .catch(() => null),
    ),
  ]);

  const modelMap = new Map<string, ModelRecord>();
  const allSources: Record<string, HttpCacheMetadata> = {};
  const allEvents: UpdateEvent[] = [];

  const upsertCatalogModel = (incoming: ModelRecord) => {
    const key = `${incoming.provider}:${incoming.canonical_id.toLowerCase()}`;
    const existing = modelMap.get(key);
    if (!existing) {
      modelMap.set(key, incoming);
      return;
    }
    const mergedAliases = new Set([...existing.aliases, ...incoming.aliases]);
    modelMap.set(key, {
      ...existing,
      aliases: [...mergedAliases],
      display_name: existing.display_name ?? incoming.display_name,
      context_window: existing.context_window ?? incoming.context_window,
      max_output_tokens: existing.max_output_tokens ?? incoming.max_output_tokens,
      supports_temperature: existing.supports_temperature ?? incoming.supports_temperature,
      supports_reasoning: existing.supports_reasoning ?? incoming.supports_reasoning,
      supports_tool_call: existing.supports_tool_call ?? incoming.supports_tool_call,
      pricing_per_1m: existing.pricing_per_1m ?? incoming.pricing_per_1m,
      deprecation_date: existing.deprecation_date ?? incoming.deprecation_date,
      shutdown_date: existing.shutdown_date ?? incoming.shutdown_date,
      status:
        existing.status === "retired" || incoming.status === "retired"
          ? "retired"
          : existing.status === "deprecated" || incoming.status === "deprecated"
            ? "deprecated"
            : existing.status,
    });
  };

  if (modelsDevRes) {
    for (const m of modelsDevRes.models) upsertCatalogModel(m);
  }
  if (litellmRes) {
    for (const m of litellmRes.models) upsertCatalogModel(m);
    allEvents.push(...litellmRes.events);
  }

  for (const native of nativeRes) {
    for (const id of native.modelIds) {
      const key = `${native.provider}:${id.toLowerCase()}`;
      if (!modelMap.has(key)) {
        upsertCatalogModel({
          canonical_id: id,
          aliases: [],
          provider: native.provider,
          status: "active",
          deprecation_date: null,
          shutdown_date: null,
          replacement_id: null,
          context_window: null,
          max_output_tokens: null,
          supports_temperature: null,
          supports_reasoning: null,
          supports_tool_call: null,
          pricing_per_1m: null,
          api_constraints: [],
          official_url: native.sourceUrl,
          source_origin: "live_verified",
          last_verified_at: generatedAt,
        });
      }
    }
  }

  for (const pRes of providerResults) {
    if (!pRes) continue;
    Object.assign(allSources, pRes.sources);
    allEvents.push(...pRes.events);

    for (const patch of pRes.models) {
      const key = `${patch.provider}:${patch.canonical_id.toLowerCase()}`;
      const existing = modelMap.get(key);
      if (!existing) {
        modelMap.set(key, {
          canonical_id: patch.canonical_id,
          aliases: patch.aliases ?? [],
          provider: patch.provider,
          display_name: patch.display_name,
          status: patch.status ?? "active",
          deprecation_date: patch.deprecation_date ?? null,
          shutdown_date: patch.shutdown_date ?? null,
          replacement_id: patch.replacement_id ?? null,
          context_window: null,
          max_output_tokens: null,
          supports_temperature: null,
          supports_reasoning: null,
          supports_tool_call: null,
          pricing_per_1m: null,
          api_constraints: patch.api_constraints ?? [],
          official_url: patch.official_url,
          source_origin: "live_verified",
          last_verified_at: generatedAt,
        });
      } else {
        const mergedAliases = new Set([...existing.aliases, ...(patch.aliases ?? [])]);
        const mergedConstraints = new Set([
          ...existing.api_constraints,
          ...(patch.api_constraints ?? []),
        ]);
        const authority = patch.authority ?? "explicit";

        if (authority === "mention") {
          modelMap.set(key, {
            ...existing,
            aliases: [...mergedAliases],
            display_name: patch.display_name ?? existing.display_name,
            api_constraints: [...mergedConstraints],
            last_verified_at: generatedAt,
          });
        } else {
          const isExplicitActive =
            (patch.status ?? "active") === "active" &&
            !patch.deprecation_date &&
            !patch.shutdown_date;
          modelMap.set(key, {
            ...existing,
            aliases: [...mergedAliases],
            display_name: patch.display_name ?? existing.display_name,
            status: isExplicitActive ? "active" : (patch.status ?? existing.status),
            deprecation_date: isExplicitActive
              ? null
              : (patch.deprecation_date ?? existing.deprecation_date),
            shutdown_date: isExplicitActive
              ? null
              : (patch.shutdown_date ?? existing.shutdown_date),
            replacement_id: isExplicitActive
              ? null
              : (patch.replacement_id ?? existing.replacement_id),
            api_constraints: [...mergedConstraints],
            official_url: patch.official_url,
            source_origin: "live_verified",
            last_verified_at: generatedAt,
          });
        }
      }
    }
  }

  const verifiedEvents =
    modelMap.size > 0
      ? allEvents.flatMap((evt) => {
          if (!evt.id.startsWith("evt_litellm_")) {
            return [evt];
          }
          const verifiedModels = evt.models_affected
            .filter((id) => modelMap.has(`${evt.provider}:${id.toLowerCase()}`))
            .slice(0, 8);
          if (verifiedModels.length === 0) {
            return [];
          }
          return [{ ...evt, models_affected: verifiedModels }];
        })
      : allEvents;

  const dedupEvents = deduplicateEvents(verifiedEvents).sort((a, b) =>
    b.published_at.localeCompare(a.published_at),
  );

  if (modelMap.size === 0 && dedupEvents.length === 0) {
    throw new Error("All upstream catalog sources failed or returned empty data");
  }

  return {
    snapshot: {
      schema_version: "1.0.0",
      generated_at: generatedAt,
      stale: false,
      models: [...modelMap.values()],
      events: dedupEvents,
    },
    sources: allSources,
  };
}

function splitGfmRow(line: string): string[] {
  const trimmed = line.replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function extractMarkdocRowCells(section: string): string[] {
  const cells: string[] = [];
  let current: string[] = [];
  for (const rawLine of section.split(/\r?\n/)) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(rawLine);
    if (bullet) {
      if (current.length > 0) {
        cells.push(current.join(" ").trim());
      }
      current = [bullet[1].trim()];
    } else if (current.length > 0 && rawLine.trim() !== "") {
      current.push(rawLine.trim());
    }
  }
  if (current.length > 0) {
    cells.push(current.join(" ").trim());
  }
  return cells;
}

function firstSentence(text: string, maxLen: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const idx = cleaned.search(/[.!?](\s|$)/);
  const sentence = idx > 0 ? cleaned.slice(0, idx + 1) : cleaned;
  return sentence.length <= maxLen ? sentence : `${sentence.slice(0, maxLen - 3)}...`;
}

function deduplicateEvents(events: UpdateEvent[]): UpdateEvent[] {
  const byId = new Map<string, UpdateEvent>();
  for (const evt of events) {
    if (!byId.has(evt.id)) {
      byId.set(evt.id, evt);
    }
  }
  return [...byId.values()];
}
