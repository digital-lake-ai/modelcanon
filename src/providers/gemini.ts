import { fetchResource } from "../http/fetcher.js";
import {
  extractDatedChangelogEvents,
  extractModelIds,
  type ProviderAdapter,
  type ProviderIngestionResult,
  type ProviderModelPatch,
  parseFlexibleDate,
  parseMarkdocTables,
  stripMarkdownNoise,
} from "../registry/providers.js";
import type { UpdateEvent } from "../schema/models.js";
import type { HttpCacheMetadata } from "../store/cache.js";

export const GEMINI_DEPRECATIONS_URL = "https://ai.google.dev/gemini-api/docs/deprecations.md.txt";
export const GEMINI_CHANGELOG_URL = "https://ai.google.dev/gemini-api/docs/changelog.md.txt";
export const GEMINI_LLMS_URL = "https://ai.google.dev/gemini-api/docs/llms.txt";

export function parseGeminiDeprecations(
  markdown: string,
  detectedAt: string,
  now: Date = new Date(detectedAt),
): { models: ProviderModelPatch[]; events: UpdateEvent[] } {
  const models: ProviderModelPatch[] = [];
  const events: UpdateEvent[] = [];
  const tables = parseMarkdocTables(markdown);

  for (const table of tables) {
    for (const row of table.rows) {
      const modelCell = row.Model ?? row["Model ID"] ?? "";
      const shutdownCell = row["Shutdown date"] ?? "";
      const replacementCell = row["Recommended replacement"] ?? "";
      const modelIds = extractModelIds(modelCell);
      if (modelIds.length === 0) continue;

      const shutdownIso = parseFlexibleDate(shutdownCell);
      const isRetired =
        shutdownIso !== null && Date.parse(`${shutdownIso}T00:00:00Z`) <= now.getTime();
      const replacementIds = extractModelIds(replacementCell);
      const replacementId = replacementIds[0] ?? null;

      const constraints: string[] = [];
      if (/automatically route/i.test(replacementCell)) {
        constraints.push(stripMarkdownNoise(replacementCell));
      }

      for (const id of modelIds) {
        models.push({
          canonical_id: id,
          provider: "gemini",
          status: isRetired ? "retired" : shutdownIso ? "deprecated" : "active",
          deprecation_date: null,
          shutdown_date: shutdownIso,
          replacement_id: replacementId,
          api_constraints: constraints,
          official_url: GEMINI_DEPRECATIONS_URL,
        });
      }

      if (shutdownIso) {
        const todayIso = detectedAt.slice(0, 10);
        const shutdownMs = Date.parse(`${shutdownIso}T00:00:00Z`);
        const withinHorizon =
          shutdownIso <= todayIso || shutdownMs - now.getTime() <= 180 * 86_400_000;
        if (withinHorizon) {
          const cleanReplacement = stripMarkdownNoise(replacementCell);
          events.push({
            id: `evt_gemini_dep_${modelIds[0]}_${shutdownIso.replace(/-/g, "")}`,
            slug: `gemini-${modelIds[0]}-shutdown-${shutdownIso}`,
            provider: "gemini",
            category: "deprecation",
            severity: isRetired ? "critical" : "warning",
            confidence: "high",
            models_affected: modelIds,
            title: `${modelIds[0]} scheduled for shutdown on ${shutdownIso}`,
            agent_summary: `${modelIds[0]} shutdown date is ${shutdownIso}; replacement: ${replacementId ?? (cleanReplacement || "see docs")}.`,
            evidence_quote:
              `${modelIds[0]} | Shutdown: ${shutdownIso} | Replacement: ${cleanReplacement}`.slice(
                0,
                200,
              ),
            source_url: GEMINI_DEPRECATIONS_URL,
            published_at: shutdownIso <= todayIso ? shutdownIso : todayIso,
            effective_date: shutdownIso,
            detected_at: detectedAt,
          });
        }
      }
    }
  }

  return { models, events };
}

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  displayName: "Google Gemini",
  primaryUrls: [GEMINI_DEPRECATIONS_URL, GEMINI_CHANGELOG_URL, GEMINI_LLMS_URL],
  async ingest(options): Promise<ProviderIngestionResult> {
    const now = options?.now ? options.now() : new Date();
    const detectedAt = now.toISOString();
    const sources: Record<string, HttpCacheMetadata> = {};

    const [depRes, chgRes] = await Promise.allSettled([
      fetchResource(GEMINI_DEPRECATIONS_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
      fetchResource(GEMINI_CHANGELOG_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
    ]);

    const models: ProviderModelPatch[] = [];
    const events: UpdateEvent[] = [];

    if (depRes.status === "fulfilled" && depRes.value.body) {
      sources[GEMINI_DEPRECATIONS_URL] = {
        etag: depRes.value.etag,
        lastModified: depRes.value.lastModified,
        sha256: depRes.value.sha256,
      };
      const parsed = parseGeminiDeprecations(depRes.value.body, detectedAt, now);
      models.push(...parsed.models);
      events.push(...parsed.events);
    }

    if (chgRes.status === "fulfilled" && chgRes.value.body) {
      sources[GEMINI_CHANGELOG_URL] = {
        etag: chgRes.value.etag,
        lastModified: chgRes.value.lastModified,
        sha256: chgRes.value.sha256,
      };
      events.push(
        ...extractDatedChangelogEvents(chgRes.value.body, {
          provider: "gemini",
          sourceUrl: GEMINI_CHANGELOG_URL,
          detectedAt,
          limit: 15,
        }),
      );
    }

    return { provider: "gemini", models, events, sources };
  },
};
