import { fetchResource } from "../http/fetcher.js";
import {
  extractDatedChangelogEvents,
  minIsoDate,
  type ProviderAdapter,
  type ProviderIngestionResult,
  type ProviderModelPatch,
  stripHtmlToText,
  stripMarkdownNoise,
} from "../registry/providers.js";
import type { UpdateEvent } from "../schema/models.js";
import type { HttpCacheMetadata } from "../store/cache.js";

export const QWEN_MODELS_MD_URL = "https://www.alibabacloud.com/help/en/model-studio/models.md";
export const QWEN_NEW_MODELS_MD_URL =
  "https://www.alibabacloud.com/help/en/model-studio/newly-released-models.md";
export const QWEN_COMPAT_MD_URL =
  "https://www.alibabacloud.com/help/en/model-studio/api-compatibility-upgrade-notice.md";

const QWEN_ALLOWED_PREFIX_REGEX = /^(?:qwen(?:\d|-)|qwq-)[a-z0-9._-]*$/i;
const QWEN_EXCLUDE_AUX_REGEX = /(?:rerank|embedding)/i;
const CARD_TITLE_REGEX = /<Card\s+title="([^"]{1,80})"/g;

function stripLeadingStyleBlock(raw: string): string {
  const closeStyleIdx = raw.lastIndexOf("</style>");
  return closeStyleIdx >= 0 ? raw.slice(closeStyleIdx + 8) : raw;
}

function isPureQwenModelId(rawId: string): boolean {
  const id = rawId.trim().toLowerCase();
  if (!id || id.includes("/") || id.includes(" ")) return false;
  if (!QWEN_ALLOWED_PREFIX_REGEX.test(id)) return false;
  if (QWEN_EXCLUDE_AUX_REGEX.test(id)) return false;
  return true;
}

export function parseQwenDocs(
  modelsMd: string,
  newlyReleasedMd: string,
  compatMd: string,
  detectedAt: string,
): { models: ProviderModelPatch[]; events: UpdateEvent[] } {
  const byId = new Map<string, ProviderModelPatch>();
  const events: UpdateEvent[] = [];
  const todayIso = detectedAt.slice(0, 10);

  const cleanModels = stripLeadingStyleBlock(modelsMd);
  for (const match of cleanModels.matchAll(CARD_TITLE_REGEX)) {
    const candidate = match[1].trim().toLowerCase();
    if (!isPureQwenModelId(candidate)) continue;
    byId.set(candidate, {
      canonical_id: candidate,
      provider: "qwen",
      authority: "explicit",
      status: "active",
      official_url: QWEN_MODELS_MD_URL,
    });
  }

  // Scope newly-released-models.md strictly to the International (Singapore) tab
  const cleanReleased = stripLeadingStyleBlock(newlyReleasedMd);
  const beijingIdx = cleanReleased.indexOf('<Tab title="China (Beijing)"');
  const intlSection = beijingIdx >= 0 ? cleanReleased.slice(0, beijingIdx) : cleanReleased;

  let currentDate: string | null = null;
  let currentHeading: string | null = null;
  let descBuffer: string[] = [];

  const flushRelease = () => {
    if (!currentDate || !currentHeading || events.length >= 15) return;
    if (!isPureQwenModelId(currentHeading)) return;

    const id = currentHeading.toLowerCase();
    if (!byId.has(id)) {
      byId.set(id, {
        canonical_id: id,
        provider: "qwen",
        authority: "mention",
        status: "active",
        official_url: QWEN_NEW_MODELS_MD_URL,
      });
    }

    const cleanedDesc = stripHtmlToText(stripMarkdownNoise(descBuffer.join(" ")), false)
      .replace(/\s+/g, " ")
      .trim();
    const summaryText = cleanedDesc || `${id} released in Alibaba Cloud Model Studio.`;
    const summary = summaryText.length <= 220 ? summaryText : `${summaryText.slice(0, 217)}...`;
    const slugTail = id
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 44);

    events.push({
      id: `evt_qwen_${currentDate.replace(/-/g, "")}_${slugTail}`,
      slug: `qwen-${currentDate}-${slugTail}`,
      provider: "qwen",
      category: "new_model",
      severity: "info",
      confidence: "high",
      models_affected: [id],
      title: `${id} released on Model Studio`,
      agent_summary: summary,
      evidence_quote: summary.slice(0, 200),
      source_url: QWEN_NEW_MODELS_MD_URL,
      published_at: minIsoDate(currentDate, todayIso),
      detected_at: detectedAt,
    });
  };

  for (const rawLine of intlSection.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const dateMatch = /^###\s+(20\d{2}-\d{2}-\d{2})$/.exec(trimmed);
    if (dateMatch) {
      flushRelease();
      currentDate = dateMatch[1];
      currentHeading = null;
      descBuffer = [];
      continue;
    }

    const modelHeading = /^####\s+([^\s<][^\r\n<]{0,79})$/.exec(trimmed);
    if (modelHeading && currentDate) {
      if (currentHeading) {
        flushRelease();
      }
      currentHeading = modelHeading[1].trim();
      descBuffer = [];
      continue;
    }

    if (
      currentDate &&
      currentHeading &&
      trimmed &&
      !trimmed.startsWith("<") &&
      !trimmed.startsWith("[Model details]")
    ) {
      descBuffer.push(trimmed);
    }
  }
  flushRelease();

  const cleanCompat = stripLeadingStyleBlock(compatMd);
  const compatEvents = extractDatedChangelogEvents(cleanCompat, {
    provider: "qwen",
    sourceUrl: QWEN_COMPAT_MD_URL,
    detectedAt,
    limit: 10,
    forceCategory: "breaking_change",
    allowedPrefixes: QWEN_ALLOWED_PREFIX_REGEX,
  }).filter((evt) => evt.models_affected.length > 0 || /\bqwen/i.test(evt.agent_summary));
  events.push(...compatEvents);

  return { models: [...byId.values()], events };
}

export const qwenAdapter: ProviderAdapter = {
  id: "qwen",
  displayName: "Alibaba Qwen",
  primaryUrls: [QWEN_MODELS_MD_URL, QWEN_NEW_MODELS_MD_URL, QWEN_COMPAT_MD_URL],
  async ingest(options): Promise<ProviderIngestionResult> {
    const now = options?.now ? options.now() : new Date();
    const detectedAt = now.toISOString();
    const sources: Record<string, HttpCacheMetadata> = {};

    const [modelsRes, newRes, compatRes] = await Promise.allSettled([
      fetchResource(QWEN_MODELS_MD_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
      fetchResource(QWEN_NEW_MODELS_MD_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
      fetchResource(QWEN_COMPAT_MD_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
    ]);

    const modelsMd =
      modelsRes.status === "fulfilled" && modelsRes.value.body ? modelsRes.value.body : "";
    const newMd = newRes.status === "fulfilled" && newRes.value.body ? newRes.value.body : "";
    const compatMd =
      compatRes.status === "fulfilled" && compatRes.value.body ? compatRes.value.body : "";

    if (modelsRes.status === "fulfilled" && modelsRes.value.body) {
      sources[QWEN_MODELS_MD_URL] = {
        etag: modelsRes.value.etag,
        lastModified: modelsRes.value.lastModified,
        sha256: modelsRes.value.sha256,
      };
    }
    if (newRes.status === "fulfilled" && newRes.value.body) {
      sources[QWEN_NEW_MODELS_MD_URL] = {
        etag: newRes.value.etag,
        lastModified: newRes.value.lastModified,
        sha256: newRes.value.sha256,
      };
    }
    if (compatRes.status === "fulfilled" && compatRes.value.body) {
      sources[QWEN_COMPAT_MD_URL] = {
        etag: compatRes.value.etag,
        lastModified: compatRes.value.lastModified,
        sha256: compatRes.value.sha256,
      };
    }

    if (!modelsMd && !newMd && !compatMd) {
      return { provider: "qwen", models: [], events: [], sources };
    }

    const parsed = parseQwenDocs(modelsMd, newMd, compatMd, detectedAt);
    return { provider: "qwen", models: parsed.models, events: parsed.events, sources };
  },
};
