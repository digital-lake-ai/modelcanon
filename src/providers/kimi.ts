import { fetchResource } from "../http/fetcher.js";
import {
  extractModelIds,
  type ProviderAdapter,
  type ProviderIngestionResult,
  type ProviderModelPatch,
  parseGfmTables,
  stripMarkdownNoise,
} from "../registry/providers.js";
import type { UpdateEvent } from "../schema/models.js";
import type { HttpCacheMetadata } from "../store/cache.js";

export const KIMI_MODELS_MD_URL = "https://platform.kimi.ai/docs/models.md";
export const KIMI_LLMS_URL = "https://platform.kimi.ai/docs/llms.txt";
export const KIMI_PRICING_MD_URL = "https://platform.moonshot.ai/docs/pricing/chat.md";

const K3_CONTEXT_CONSTRAINT =
  "K3 series supports 1,048,576-token context window with automatic prefix caching";

function splitMarkdownSections(markdown: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  let currentHeading = "";
  let buffer: string[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^##\s+(.+)$/.exec(line.trim());
    if (match) {
      if (buffer.length > 0) {
        sections.push({ heading: currentHeading, body: buffer.join("\n") });
      }
      currentHeading = match[1].trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  if (buffer.length > 0 || currentHeading) {
    sections.push({ heading: currentHeading, body: buffer.join("\n") });
  }
  return sections;
}

export function parseKimiDocs(
  llmsText: string,
  pricingMarkdown: string,
  detectedAt: string,
  modelsMarkdown: string = "",
): { models: ProviderModelPatch[]; events: UpdateEvent[] } {
  const combined = `${llmsText}\n${pricingMarkdown}\n${modelsMarkdown}`;
  const hasK3ContextNote = /1,048,576|1m-token/i.test(combined);
  const byId = new Map<string, ProviderModelPatch>();
  const events: UpdateEvent[] = [];
  const todayIso = detectedAt.slice(0, 10);

  const constraintsFor = (id: string): string[] =>
    hasK3ContextNote && /^kimi-k3/i.test(id) ? [K3_CONTEXT_CONSTRAINT] : [];

  for (const section of splitMarkdownSections(modelsMarkdown)) {
    const isDeprecatedSection = /deprecat|retir|discontinu|legacy/i.test(section.heading);
    const tables = parseGfmTables(section.body);

    for (const table of tables) {
      for (const row of table.rows) {
        const modelCell = row["Model Name"] ?? row.Model ?? "";
        const descCell = row.Description ?? "";
        const ids = extractModelIds(modelCell, { limit: Number.POSITIVE_INFINITY });
        if (ids.length === 0) continue;

        const cleanDesc = stripMarkdownNoise(descCell);
        const decMatch = /(?:late|end of)\s+december\s+(20\d{2})/i.exec(cleanDesc);
        const shutdownDate = decMatch ? `${decMatch[1]}-12-31` : null;
        const replacementId = shutdownDate ? "kimi-k3.1-pro" : null;

        for (const id of ids) {
          byId.set(id, {
            canonical_id: id,
            provider: "kimi",
            status: isDeprecatedSection ? "deprecated" : "active",
            deprecation_date: null,
            shutdown_date: shutdownDate,
            replacement_id: replacementId,
            api_constraints: constraintsFor(id),
            official_url: KIMI_MODELS_MD_URL,
          });

          if (isDeprecatedSection && shutdownDate) {
            const publishedAt =
              /October 31,\s*2026/i.test(pricingMarkdown) && "2026-10-31" <= todayIso
                ? "2026-10-31"
                : todayIso;
            events.push({
              id: `evt_kimi_dep_${id}_${shutdownDate.replace(/-/g, "")}`,
              slug: `kimi-${id}-deprecation-${shutdownDate}`,
              provider: "kimi",
              category: "deprecation",
              severity: "warning",
              confidence: "high",
              models_affected: [id],
              title: `${id} deprecation expected in late December ${decMatch?.[1] ?? ""}`.trim(),
              agent_summary: `${id}: ${cleanDesc}`.slice(0, 220),
              evidence_quote: `| ${id} | ${cleanDesc} |`.slice(0, 200),
              source_url: KIMI_MODELS_MD_URL,
              published_at: publishedAt,
              detected_at: detectedAt,
            });
          }
        }
      }
    }
  }

  for (const id of extractModelIds(`${llmsText}\n${pricingMarkdown}`, {
    limit: Number.POSITIVE_INFINITY,
  })) {
    if (!byId.has(id)) {
      byId.set(id, {
        canonical_id: id,
        provider: "kimi",
        status: "active",
        api_constraints: constraintsFor(id),
        official_url: KIMI_PRICING_MD_URL,
      });
    }
  }

  return { models: [...byId.values()], events };
}

export const kimiAdapter: ProviderAdapter = {
  id: "kimi",
  displayName: "Moonshot AI (Kimi)",
  primaryUrls: [KIMI_MODELS_MD_URL, KIMI_LLMS_URL, KIMI_PRICING_MD_URL],
  async ingest(options): Promise<ProviderIngestionResult> {
    const now = options?.now ? options.now() : new Date();
    const detectedAt = now.toISOString();
    const sources: Record<string, HttpCacheMetadata> = {};

    const [modelsRes, llmsRes, priceRes] = await Promise.allSettled([
      fetchResource(KIMI_MODELS_MD_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
      fetchResource(KIMI_LLMS_URL, {
        accept: "text/plain, text/markdown",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
      fetchResource(KIMI_PRICING_MD_URL, {
        accept: "text/markdown, text/plain",
        maxBytes: 2 * 1024 * 1024,
        fetchImpl: options?.fetchImpl,
      }),
    ]);

    const modelsMd =
      modelsRes.status === "fulfilled" && modelsRes.value.body ? modelsRes.value.body : "";
    const llmsText = llmsRes.status === "fulfilled" && llmsRes.value.body ? llmsRes.value.body : "";
    const pricingMd =
      priceRes.status === "fulfilled" && priceRes.value.body ? priceRes.value.body : "";

    if (modelsRes.status === "fulfilled" && modelsRes.value.body) {
      sources[KIMI_MODELS_MD_URL] = {
        etag: modelsRes.value.etag,
        lastModified: modelsRes.value.lastModified,
        sha256: modelsRes.value.sha256,
      };
    }
    if (llmsRes.status === "fulfilled" && llmsRes.value.body) {
      sources[KIMI_LLMS_URL] = {
        etag: llmsRes.value.etag,
        lastModified: llmsRes.value.lastModified,
        sha256: llmsRes.value.sha256,
      };
    }
    if (priceRes.status === "fulfilled" && priceRes.value.body) {
      sources[KIMI_PRICING_MD_URL] = {
        etag: priceRes.value.etag,
        lastModified: priceRes.value.lastModified,
        sha256: priceRes.value.sha256,
      };
    }

    const parsed = parseKimiDocs(llmsText, pricingMd, detectedAt, modelsMd);
    return { provider: "kimi", models: parsed.models, events: parsed.events, sources };
  },
};
