import { fetchResource } from "../http/fetcher.js";
import {
  extractDatedChangelogEvents,
  extractModelIds,
  type ProviderAdapter,
  type ProviderIngestionResult,
  type ProviderModelPatch,
  parseFlexibleDate,
  parseGfmTables,
  stripMarkdownNoise,
} from "../registry/providers.js";
import type { ModelStatus, UpdateEvent } from "../schema/models.js";
import type { HttpCacheMetadata } from "../store/cache.js";

export const OPENAI_DEPRECATIONS_URL = "https://developers.openai.com/api/docs/deprecations.md";
export const OPENAI_CHANGELOG_URL = "https://developers.openai.com/api/docs/changelog.md";
export const OPENAI_RSS_URL = "https://openai.com/news/rss.xml";

export function parseOpenAiDeprecations(
  markdown: string,
  detectedAt: string,
  now: Date = new Date(detectedAt),
): { models: ProviderModelPatch[]; events: UpdateEvent[] } {
  const byId = new Map<string, ProviderModelPatch>();
  const events: UpdateEvent[] = [];
  const tables = parseGfmTables(markdown);

  for (const table of tables) {
    for (const row of table.rows) {
      const shutdownRaw = row["Shutdown date"] ?? "";
      const affectedRaw = row["Affected model"] ?? row.Model ?? "";
      const statusRaw = (row.Status ?? "").toLowerCase();
      const replacementRaw = row["Recommended replacement"] ?? "";
      const noticeRaw = row["Notice date"] ?? "";

      const modelIds = extractModelIds(affectedRaw);
      if (modelIds.length === 0) continue;

      const shutdownIso = parseFlexibleDate(shutdownRaw);
      const noticeIso = parseFlexibleDate(noticeRaw);
      const isRetired =
        statusRaw.includes("shut") ||
        statusRaw.includes("retired") ||
        (shutdownIso !== null && Date.parse(`${shutdownIso}T00:00:00Z`) <= now.getTime());
      const status: ModelStatus = isRetired ? "retired" : "deprecated";
      const replacementIds = extractModelIds(replacementRaw);
      const replacementId = replacementIds[0] ?? null;

      const primaryId = modelIds[0];
      const aliases = modelIds.slice(1);
      const constraints: string[] = [];
      if (/responses api/i.test(replacementRaw)) {
        constraints.push("Recommended replacement targets the Responses API (/v1/responses)");
      }

      for (const id of modelIds) {
        const siblingAliases = id === primaryId ? aliases : [primaryId];
        byId.set(id, {
          canonical_id: id,
          provider: "openai",
          aliases: siblingAliases,
          status,
          deprecation_date: noticeIso,
          shutdown_date: shutdownIso,
          replacement_id: replacementId,
          api_constraints: constraints,
          official_url: OPENAI_DEPRECATIONS_URL,
        });
      }

      if (shutdownIso) {
        const cleanAffected = stripMarkdownNoise(affectedRaw);
        const cleanReplacement = stripMarkdownNoise(replacementRaw);
        events.push({
          id: `evt_openai_dep_${primaryId}_${shutdownIso.replace(/-/g, "")}`,
          slug: `openai-${primaryId}-shutdown-${shutdownIso}`,
          provider: "openai",
          category: "deprecation",
          severity: status === "retired" ? "critical" : "warning",
          confidence: "high",
          models_affected: modelIds,
          title: `${primaryId} shutdown scheduled for ${shutdownIso}`,
          agent_summary: `${cleanAffected} shutdown date is ${shutdownIso}; replacement: ${cleanReplacement || "see docs"}.`,
          evidence_quote:
            `| ${shutdownIso} | ${cleanAffected} | ${row.Status ?? "Deprecated"} | ${cleanReplacement} |`.slice(
              0,
              200,
            ),
          source_url: OPENAI_DEPRECATIONS_URL,
          published_at: noticeIso ?? shutdownIso,
          detected_at: detectedAt,
        });
      }
    }
  }

  return { models: [...byId.values()], events };
}

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  displayName: "OpenAI",
  primaryUrls: [OPENAI_DEPRECATIONS_URL, OPENAI_CHANGELOG_URL, OPENAI_RSS_URL],
  async ingest(options): Promise<ProviderIngestionResult> {
    const now = options?.now ? options.now() : new Date();
    const detectedAt = now.toISOString();
    const sources: Record<string, HttpCacheMetadata> = {};

    const [depRes, chgRes] = await Promise.allSettled([
      fetchResource(OPENAI_DEPRECATIONS_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
      fetchResource(OPENAI_CHANGELOG_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
    ]);

    const models: ProviderModelPatch[] = [];
    const events: UpdateEvent[] = [];

    if (depRes.status === "fulfilled" && depRes.value.body) {
      sources[OPENAI_DEPRECATIONS_URL] = {
        etag: depRes.value.etag,
        lastModified: depRes.value.lastModified,
        sha256: depRes.value.sha256,
      };
      const parsed = parseOpenAiDeprecations(depRes.value.body, detectedAt, now);
      models.push(...parsed.models);
      events.push(...parsed.events);
    }

    if (chgRes.status === "fulfilled" && chgRes.value.body) {
      sources[OPENAI_CHANGELOG_URL] = {
        etag: chgRes.value.etag,
        lastModified: chgRes.value.lastModified,
        sha256: chgRes.value.sha256,
      };
      events.push(
        ...extractDatedChangelogEvents(chgRes.value.body, {
          provider: "openai",
          sourceUrl: OPENAI_CHANGELOG_URL,
          detectedAt,
          limit: 15,
        }),
      );
    }

    return { provider: "openai", models, events, sources };
  },
};
