import { fetchResource } from "../http/fetcher.js";
import {
  extractModelIds,
  minIsoDate,
  type ProviderAdapter,
  type ProviderIngestionResult,
  type ProviderModelPatch,
  parseGfmTables,
  stripMarkdownNoise,
} from "../registry/providers.js";
import type { UpdateEvent } from "../schema/models.js";
import type { HttpCacheMetadata } from "../store/cache.js";

export const ZAI_PRICING_MD_URL = "https://docs.z.ai/guides/overview/pricing.md";
export const ZAI_RELEASE_NOTES_MD_URL = "https://docs.z.ai/release-notes.md";
export const ZAI_LLMS_URL = "https://docs.z.ai/llms.txt";

const ZAI_ID_PREFIX_REGEX = /^glm-\d/i;

export function parseZaiDocs(
  pricingMd: string,
  releaseNotesMd: string,
  detectedAt: string,
): { models: ProviderModelPatch[]; events: UpdateEvent[] } {
  const byId = new Map<string, ProviderModelPatch>();
  const events: UpdateEvent[] = [];
  const todayIso = detectedAt.slice(0, 10);

  // Unwrap blockquote accordion indentation ("> | ...") so all pricing tables parse cleanly
  const unwrappedPricing = pricingMd
    .split(/\r?\n/)
    .map((line) => line.replace(/^>\s?/, ""))
    .join("\n");

  for (const table of parseGfmTables(unwrappedPricing)) {
    for (const row of table.rows) {
      const modelCell = row.Model ?? "";
      if (!modelCell) continue;

      const ids = extractModelIds(modelCell, {
        limit: Number.POSITIVE_INFINITY,
        allowedPrefixes: ZAI_ID_PREFIX_REGEX,
      });
      for (const id of ids) {
        if (!byId.has(id)) {
          byId.set(id, {
            canonical_id: id,
            provider: "zai",
            authority: "explicit",
            status: "active",
            official_url: ZAI_PRICING_MD_URL,
          });
        }
      }
    }
  }

  // Extract dated release blocks formatted as "**YYYY-MM-DD**"
  let currentDate: string | null = null;
  let buffer: string[] = [];

  const flushBlock = () => {
    if (!currentDate || buffer.length === 0 || events.length >= 15) return;
    const rawBlock = buffer.join(" ").replace(/\s+/g, " ").trim();
    const cleaned = stripMarkdownNoise(rawBlock);
    if (cleaned.length < 20) return;

    const models = extractModelIds(rawBlock, {
      limit: Number.POSITIVE_INFINITY,
      allowedPrefixes: ZAI_ID_PREFIX_REGEX,
    });
    if (models.length === 0) return;

    for (const id of models) {
      if (!byId.has(id)) {
        byId.set(id, {
          canonical_id: id,
          provider: "zai",
          authority: "mention",
          status: "active",
          official_url: ZAI_RELEASE_NOTES_MD_URL,
        });
      }
    }

    const periodIdx = cleaned.search(/[.!?](\s|$)/);
    const first = periodIdx > 0 ? cleaned.slice(0, periodIdx + 1) : cleaned;
    const summary = first.length <= 220 ? first : `${first.slice(0, 217)}...`;
    const slugTail = `${models[0]}-${summary}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 44);

    events.push({
      id: `evt_zai_${currentDate.replace(/-/g, "")}_${slugTail}`,
      slug: `zai-${currentDate}-${slugTail}`,
      provider: "zai",
      category: "new_model",
      severity: "info",
      confidence: "high",
      models_affected: models,
      title: `${models[0]} release update (${currentDate})`,
      agent_summary: summary,
      evidence_quote: summary.slice(0, 200),
      source_url: ZAI_RELEASE_NOTES_MD_URL,
      published_at: minIsoDate(currentDate, todayIso),
      detected_at: detectedAt,
    });
  };

  for (const rawLine of releaseNotesMd.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const dateMatch = /^\*\*(20\d{2}-\d{2}-\d{2})\*\*$/.exec(trimmed);
    if (dateMatch) {
      flushBlock();
      currentDate = dateMatch[1];
      buffer = [];
      continue;
    }
    if (currentDate && trimmed) {
      buffer.push(trimmed);
    }
  }
  flushBlock();

  return { models: [...byId.values()], events };
}

export const zaiAdapter: ProviderAdapter = {
  id: "zai",
  displayName: "Z.ai GLM",
  primaryUrls: [ZAI_PRICING_MD_URL, ZAI_RELEASE_NOTES_MD_URL, ZAI_LLMS_URL],
  async ingest(options): Promise<ProviderIngestionResult> {
    const now = options?.now ? options.now() : new Date();
    const detectedAt = now.toISOString();
    const sources: Record<string, HttpCacheMetadata> = {};

    const [pricingRes, relRes] = await Promise.allSettled([
      fetchResource(ZAI_PRICING_MD_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
      fetchResource(ZAI_RELEASE_NOTES_MD_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
    ]);

    const pricingMd =
      pricingRes.status === "fulfilled" && pricingRes.value.body ? pricingRes.value.body : "";
    const relMd = relRes.status === "fulfilled" && relRes.value.body ? relRes.value.body : "";

    if (pricingRes.status === "fulfilled" && pricingRes.value.body) {
      sources[ZAI_PRICING_MD_URL] = {
        etag: pricingRes.value.etag,
        lastModified: pricingRes.value.lastModified,
        sha256: pricingRes.value.sha256,
      };
    }
    if (relRes.status === "fulfilled" && relRes.value.body) {
      sources[ZAI_RELEASE_NOTES_MD_URL] = {
        etag: relRes.value.etag,
        lastModified: relRes.value.lastModified,
        sha256: relRes.value.sha256,
      };
    }

    if (!pricingMd && !relMd) {
      return { provider: "zai", models: [], events: [], sources };
    }

    const parsed = parseZaiDocs(pricingMd, relMd, detectedAt);
    return { provider: "zai", models: parsed.models, events: parsed.events, sources };
  },
};
