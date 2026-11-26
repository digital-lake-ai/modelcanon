import { fetchResource } from "../http/fetcher.js";
import {
  classifyUpdateText,
  extractModelIds,
  type ProviderAdapter,
  type ProviderIngestionResult,
  type ProviderModelPatch,
  parseFlexibleDate,
} from "../registry/providers.js";
import type { UpdateEvent } from "../schema/models.js";
import type { HttpCacheMetadata } from "../store/cache.js";

export const DEEPSEEK_UPDATES_URL = "https://api-docs.deepseek.com/updates";

export function parseDeepSeekUpdatesHtml(
  html: string,
  detectedAt: string,
): { models: ProviderModelPatch[]; events: UpdateEvent[] } {
  // Strip script/style blocks and decode tags into readable plain lines.
  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?(?:h[1-6]|p|li|div|section|article|br)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u200B/g, "");

  const lines = plain
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const events: UpdateEvent[] = [];
  const modelMap = new Map<string, ProviderModelPatch>();

  let currentDate: string | null = null;
  let currentTitle: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!currentDate || buffer.length === 0 || events.length >= 15) return;
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (text.length < 20) return;

    const title = currentTitle ?? text.slice(0, 85);
    const { category, severity } = classifyUpdateText(`${title} ${text}`);
    const models = extractModelIds(`${title} ${text}`);
    for (const id of models) {
      if (!modelMap.has(id)) {
        modelMap.set(id, {
          canonical_id: id,
          provider: "deepseek",
          status: "active",
          official_url: DEEPSEEK_UPDATES_URL,
        });
      }
    }

    const periodIdx = text.search(/[.!?](\s|$)/);
    const first = periodIdx > 0 ? text.slice(0, periodIdx + 1) : text;
    const summary = first.length <= 220 ? first : `${first.slice(0, 217)}...`;
    const slugTail = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 44);

    events.push({
      id: `evt_deepseek_${currentDate.replace(/-/g, "")}_${slugTail}`,
      slug: `deepseek-${currentDate}-${slugTail}`,
      provider: "deepseek",
      category,
      severity,
      confidence: "medium",
      models_affected: models,
      title,
      agent_summary: summary,
      evidence_quote: summary.slice(0, 200),
      source_url: DEEPSEEK_UPDATES_URL,
      published_at: currentDate,
      detected_at: detectedAt,
    });
  };

  for (const line of lines) {
    const dateMatch = /^Date:\s*(\d{4}-\d{2}-\d{2})$/i.exec(line);
    if (dateMatch) {
      flush();
      currentDate = parseFlexibleDate(dateMatch[1]);
      currentTitle = null;
      buffer = [];
      continue;
    }
    if (!currentDate) continue;

    if (!currentTitle && line.length > 8 && line.length < 120) {
      currentTitle = line;
      continue;
    }
    buffer.push(line);
  }
  flush();

  return { models: [...modelMap.values()], events };
}

export const deepseekAdapter: ProviderAdapter = {
  id: "deepseek",
  displayName: "DeepSeek",
  primaryUrls: [DEEPSEEK_UPDATES_URL],
  async ingest(options): Promise<ProviderIngestionResult> {
    const now = options?.now ? options.now() : new Date();
    const detectedAt = now.toISOString();
    const sources: Record<string, HttpCacheMetadata> = {};

    const res = await fetchResource(DEEPSEEK_UPDATES_URL, {
      accept: "text/html",
      maxBytes: 2 * 1024 * 1024,
      fetchImpl: options?.fetchImpl,
    });

    if (!res.body) {
      return { provider: "deepseek", models: [], events: [], sources };
    }

    sources[DEEPSEEK_UPDATES_URL] = {
      etag: res.etag,
      lastModified: res.lastModified,
      sha256: res.sha256,
    };

    const parsed = parseDeepSeekUpdatesHtml(res.body, detectedAt);
    return { provider: "deepseek", models: parsed.models, events: parsed.events, sources };
  },
};
