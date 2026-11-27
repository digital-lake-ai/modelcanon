import { fetchResource } from "../http/fetcher.js";
import {
  extractModelIds,
  minIsoDate,
  type ProviderAdapter,
  type ProviderIngestionResult,
  type ProviderModelPatch,
  parseFlexibleDate,
  parseGfmTables,
  stripMarkdownNoise,
} from "../registry/providers.js";
import type { UpdateEvent } from "../schema/models.js";
import type { HttpCacheMetadata } from "../store/cache.js";

export const XAI_MODELS_MD_URL = "https://docs.x.ai/developers/models.md";
export const XAI_RELEASE_NOTES_MD_URL = "https://docs.x.ai/developers/release-notes.md";
export const XAI_LLMS_URL = "https://docs.x.ai/llms.txt";

const LONG_CONTEXT_CONSTRAINT = "Long-context tier pricing applies at >= 200k prompt tokens";
const XAI_ID_PREFIX_REGEX = /^grok-/i;
const FULL_DATE_IN_BODY_REGEX =
  /\b(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*20\d{2}|20\d{2}-\d{2}-\d{2})\b/i;

function splitReleaseNoteSubsections(markdown: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  let heading = "";
  let buffer: string[] = [];

  for (const rawLine of markdown.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (/^##\s+/.test(trimmed)) {
      if (heading && buffer.length > 0) {
        sections.push({ heading, body: buffer.join(" ").replace(/\s+/g, " ").trim() });
      }
      heading = "";
      buffer = [];
      continue;
    }
    const subMatch = /^###\s+(.+)$/.exec(trimmed);
    if (subMatch) {
      if (heading && buffer.length > 0) {
        sections.push({ heading, body: buffer.join(" ").replace(/\s+/g, " ").trim() });
      }
      heading = subMatch[1].trim();
      buffer = [];
      continue;
    }
    if (heading && trimmed) {
      buffer.push(trimmed);
    }
  }
  if (heading && buffer.length > 0) {
    sections.push({ heading, body: buffer.join(" ").replace(/\s+/g, " ").trim() });
  }
  return sections;
}

export function parseXaiDocs(
  modelsMd: string,
  releaseNotesMd: string,
  detectedAt: string,
): { models: ProviderModelPatch[]; events: UpdateEvent[] } {
  const byId = new Map<string, ProviderModelPatch>();
  const events: UpdateEvent[] = [];
  const todayIso = detectedAt.slice(0, 10);

  for (const table of parseGfmTables(modelsMd)) {
    for (const row of table.rows) {
      const cell = row.Model ?? row.Mode ?? "";
      if (!cell) continue;
      const ids = extractModelIds(cell, {
        limit: Number.POSITIVE_INFINITY,
        allowedPrefixes: XAI_ID_PREFIX_REGEX,
      });
      if (ids.length === 0) continue;

      const isDeprecated = /\bdeprecated\b/i.test(cell);
      const hasLongContext = /(?:>=|≥)\s*200k/i.test(cell);

      for (const id of ids) {
        const existing = byId.get(id);
        const constraints = new Set(existing?.api_constraints ?? []);
        if (hasLongContext) {
          constraints.add(LONG_CONTEXT_CONSTRAINT);
        }
        const status = existing?.status === "deprecated" || isDeprecated ? "deprecated" : "active";

        byId.set(id, {
          canonical_id: id,
          provider: "xai",
          authority: "explicit",
          status,
          api_constraints: [...constraints],
          official_url: XAI_MODELS_MD_URL,
        });
      }
    }
  }

  for (const section of splitReleaseNoteSubsections(releaseNotesMd)) {
    const cleanBody = stripMarkdownNoise(section.body);
    const dateMatch = FULL_DATE_IN_BODY_REGEX.exec(cleanBody);
    if (!dateMatch) continue;

    const dateIso = parseFlexibleDate(dateMatch[0]);
    if (!dateIso) continue;

    const isLifecycle = /\b(?:end of life|retired|deprecat\w*)\b/i.test(section.heading);
    if (!isLifecycle) continue;

    const affected = extractModelIds(section.heading, {
      limit: Number.POSITIVE_INFINITY,
      allowedPrefixes: XAI_ID_PREFIX_REGEX,
    });
    if (affected.length === 0) continue;

    const repMatch = /\b(?:routed to|served by|set model to)\s+(grok-[a-z0-9._-]+)/i.exec(
      cleanBody,
    );
    const replacementId = repMatch?.[1]?.toLowerCase() ?? null;
    const isRetired = dateIso <= todayIso;

    for (const id of affected) {
      const existing = byId.get(id);
      byId.set(id, {
        canonical_id: id,
        provider: "xai",
        authority: "explicit",
        status: isRetired ? "retired" : "deprecated",
        deprecation_date: existing?.deprecation_date ?? null,
        shutdown_date: dateIso,
        replacement_id: replacementId,
        api_constraints: existing?.api_constraints ?? [],
        official_url: XAI_RELEASE_NOTES_MD_URL,
      });
    }

    const summary = cleanBody.length <= 220 ? cleanBody : `${cleanBody.slice(0, 217)}...`;
    const slugTail = section.heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 44);

    events.push({
      id: `evt_xai_dep_${dateIso.replace(/-/g, "")}_${slugTail}`,
      slug: `xai-${dateIso}-${slugTail}`,
      provider: "xai",
      category: "deprecation",
      severity: isRetired ? "critical" : "warning",
      confidence: "high",
      models_affected: affected,
      title: stripMarkdownNoise(section.heading).slice(0, 90),
      agent_summary: summary,
      evidence_quote: summary.slice(0, 200),
      source_url: XAI_RELEASE_NOTES_MD_URL,
      published_at: minIsoDate(dateIso, todayIso),
      effective_date: dateIso,
      detected_at: detectedAt,
    });
  }

  return { models: [...byId.values()], events };
}

export const xaiAdapter: ProviderAdapter = {
  id: "xai",
  displayName: "xAI Grok",
  primaryUrls: [XAI_MODELS_MD_URL, XAI_RELEASE_NOTES_MD_URL, XAI_LLMS_URL],
  async ingest(options): Promise<ProviderIngestionResult> {
    const now = options?.now ? options.now() : new Date();
    const detectedAt = now.toISOString();
    const sources: Record<string, HttpCacheMetadata> = {};

    const [modelsRes, relRes] = await Promise.allSettled([
      fetchResource(XAI_MODELS_MD_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
      fetchResource(XAI_RELEASE_NOTES_MD_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
    ]);

    const modelsMd =
      modelsRes.status === "fulfilled" && modelsRes.value.body ? modelsRes.value.body : "";
    const relMd = relRes.status === "fulfilled" && relRes.value.body ? relRes.value.body : "";

    if (modelsRes.status === "fulfilled" && modelsRes.value.body) {
      sources[XAI_MODELS_MD_URL] = {
        etag: modelsRes.value.etag,
        lastModified: modelsRes.value.lastModified,
        sha256: modelsRes.value.sha256,
      };
    }
    if (relRes.status === "fulfilled" && relRes.value.body) {
      sources[XAI_RELEASE_NOTES_MD_URL] = {
        etag: relRes.value.etag,
        lastModified: relRes.value.lastModified,
        sha256: relRes.value.sha256,
      };
    }

    if (!modelsMd && !relMd) {
      return { provider: "xai", models: [], events: [], sources };
    }

    const parsed = parseXaiDocs(modelsMd, relMd, detectedAt);
    return { provider: "xai", models: parsed.models, events: parsed.events, sources };
  },
};
