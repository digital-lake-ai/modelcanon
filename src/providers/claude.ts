import { fetchResource } from "../http/fetcher.js";
import {
  extractDatedChangelogEvents,
  extractModelIds,
  minIsoDate,
  type ProviderAdapter,
  type ProviderIngestionResult,
  type ProviderModelPatch,
  parseFlexibleDate,
  parseGfmTables,
} from "../registry/providers.js";
import type { ModelStatus, UpdateEvent } from "../schema/models.js";
import type { HttpCacheMetadata } from "../store/cache.js";

export const CLAUDE_DEPRECATIONS_URL =
  "https://platform.claude.com/docs/en/about-claude/model-deprecations.md";
export const CLAUDE_CHANGELOG_URL = "https://platform.claude.com/docs/en/release-notes/overview.md";
export const CLAUDE_LLMS_URL = "https://platform.claude.com/llms.txt";

export function parseClaudeDeprecations(
  markdown: string,
  detectedAt: string,
): { models: ProviderModelPatch[]; events: UpdateEvent[] } {
  const byId = new Map<string, ProviderModelPatch>();
  const events: UpdateEvent[] = [];
  const tables = parseGfmTables(markdown);

  // Table 1: Model status (API model name | Current state | Deprecated | Tentative retirement date)
  // Table 2+: History (Retirement date | Deprecated model | Recommended replacement)
  for (const table of tables) {
    for (const row of table.rows) {
      if ("API model name" in row && "Current state" in row) {
        const id = extractModelIds(row["API model name"])[0];
        if (!id) continue;
        const stateRaw = row["Current state"].toLowerCase();
        const status: ModelStatus = stateRaw.includes("retired")
          ? "retired"
          : stateRaw.includes("deprecated")
            ? "deprecated"
            : "active";
        const depDate = parseFlexibleDate(row.Deprecated ?? "");
        const retDate = parseFlexibleDate(row["Tentative retirement date"] ?? "");

        byId.set(id, {
          canonical_id: id,
          provider: "claude",
          aliases: [],
          status,
          deprecation_date: depDate,
          shutdown_date: retDate,
          replacement_id: null,
          official_url: CLAUDE_DEPRECATIONS_URL,
        });
      } else if ("Deprecated model" in row && "Recommended replacement" in row) {
        const depId = extractModelIds(row["Deprecated model"])[0];
        const repId = extractModelIds(row["Recommended replacement"])[0] ?? null;
        const retDate = parseFlexibleDate(row["Retirement date"] ?? "");
        if (!depId) continue;

        const existing = byId.get(depId);
        const status: ModelStatus = existing?.status ?? "deprecated";
        byId.set(depId, {
          canonical_id: depId,
          provider: "claude",
          aliases: existing?.aliases ?? [],
          status,
          deprecation_date: existing?.deprecation_date ?? null,
          shutdown_date: retDate ?? existing?.shutdown_date ?? null,
          replacement_id: repId ?? existing?.replacement_id ?? null,
          official_url: CLAUDE_DEPRECATIONS_URL,
        });

        if (retDate) {
          const todayIso = detectedAt.slice(0, 10);
          const publishedAt =
            existing?.deprecation_date && existing.deprecation_date <= todayIso
              ? existing.deprecation_date
              : minIsoDate(retDate, todayIso);
          events.push({
            id: `evt_claude_dep_${depId}_${retDate.replace(/-/g, "")}`,
            slug: `claude-${depId}-retirement-${retDate}`,
            provider: "claude",
            category: "deprecation",
            severity: status === "retired" ? "critical" : "warning",
            confidence: "high",
            models_affected: [depId],
            title: `${depId} scheduled for retirement on ${retDate}`,
            agent_summary: `${depId} retirement date is ${retDate}; recommended replacement: ${repId ?? "see docs"}.`,
            evidence_quote: `| ${retDate} | ${depId} | ${repId ?? "N/A"} |`,
            source_url: CLAUDE_DEPRECATIONS_URL,
            published_at: publishedAt,
            effective_date: retDate,
            detected_at: detectedAt,
          });
        }
      }
    }
  }

  // Extract undated alias notes linearly without multi-line regex backtracking:
  // "This retirement includes `claude-sonnet-4-5`, the same model's ID without a date."
  let lastDatedId: string | null = null;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("|")) {
      const datedMatch = extractModelIds(line).find((id) => /-\d{8}$/.test(id));
      if (datedMatch) {
        lastDatedId = datedMatch;
      }
      continue;
    }

    if (lastDatedId && /this retirement includes/i.test(line)) {
      const undatedAlias = extractModelIds(line).find((id) => !/-\d{8}$/.test(id));
      const datedRecord = byId.get(lastDatedId);
      if (undatedAlias && datedRecord) {
        const aliases = new Set([...(datedRecord.aliases ?? []), undatedAlias]);
        byId.set(lastDatedId, { ...datedRecord, aliases: [...aliases] });

        if (!byId.has(undatedAlias)) {
          byId.set(undatedAlias, {
            canonical_id: undatedAlias,
            provider: "claude",
            aliases: [lastDatedId],
            status: datedRecord.status,
            deprecation_date: datedRecord.deprecation_date,
            shutdown_date: datedRecord.shutdown_date,
            replacement_id: datedRecord.replacement_id,
            official_url: CLAUDE_DEPRECATIONS_URL,
          });
        }
      }
      lastDatedId = null;
    }
  }

  return { models: [...byId.values()], events };
}

export const claudeAdapter: ProviderAdapter = {
  id: "claude",
  displayName: "Anthropic Claude",
  primaryUrls: [CLAUDE_DEPRECATIONS_URL, CLAUDE_CHANGELOG_URL, CLAUDE_LLMS_URL],
  async ingest(options): Promise<ProviderIngestionResult> {
    const now = options?.now ? options.now() : new Date();
    const detectedAt = now.toISOString();
    const sources: Record<string, HttpCacheMetadata> = {};

    const [depRes, chgRes] = await Promise.allSettled([
      fetchResource(CLAUDE_DEPRECATIONS_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
      fetchResource(CLAUDE_CHANGELOG_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
    ]);

    const models: ProviderModelPatch[] = [];
    const events: UpdateEvent[] = [];

    if (depRes.status === "fulfilled" && depRes.value.body) {
      sources[CLAUDE_DEPRECATIONS_URL] = {
        etag: depRes.value.etag,
        lastModified: depRes.value.lastModified,
        sha256: depRes.value.sha256,
      };
      const parsed = parseClaudeDeprecations(depRes.value.body, detectedAt);
      models.push(...parsed.models);
      events.push(...parsed.events);
    }

    if (chgRes.status === "fulfilled" && chgRes.value.body) {
      sources[CLAUDE_CHANGELOG_URL] = {
        etag: chgRes.value.etag,
        lastModified: chgRes.value.lastModified,
        sha256: chgRes.value.sha256,
      };
      events.push(
        ...extractDatedChangelogEvents(chgRes.value.body, {
          provider: "claude",
          sourceUrl: CLAUDE_CHANGELOG_URL,
          detectedAt,
          limit: 15,
        }),
      );
    }

    return { provider: "claude", models, events, sources };
  },
};
