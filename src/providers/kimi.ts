import { fetchResource } from "../http/fetcher.js";
import {
  extractModelIds,
  type ProviderAdapter,
  type ProviderIngestionResult,
  type ProviderModelPatch,
  stripMarkdownNoise,
} from "../registry/providers.js";
import type { UpdateEvent } from "../schema/models.js";
import type { HttpCacheMetadata } from "../store/cache.js";

export const KIMI_LLMS_URL = "https://platform.kimi.ai/docs/llms.txt";
export const KIMI_PRICING_MD_URL = "https://platform.moonshot.ai/docs/pricing/chat.md";

export function parseKimiDocs(
  llmsText: string,
  pricingMarkdown: string,
  detectedAt: string,
): { models: ProviderModelPatch[]; events: UpdateEvent[] } {
  const combined = `${llmsText}\n${pricingMarkdown}`;
  const modelIds = extractModelIds(combined);
  const models: ProviderModelPatch[] = [];
  const events: UpdateEvent[] = [];

  for (const id of modelIds) {
    models.push({
      canonical_id: id,
      provider: "kimi",
      status: "active",
      api_constraints: /1,048,576|1m-token/i.test(combined)
        ? ["K3 series supports 1,048,576-token context window with automatic prefix caching"]
        : [],
      official_url: KIMI_PRICING_MD_URL,
    });
  }

  for (const line of llmsText.split(/\r?\n/)) {
    const bullet = /^-\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\):\s*(.+)$/.exec(line.trim());
    if (!bullet) continue;
    const [, title, url, desc] = bullet;
    if (!/(kimi|k3|moonshot|reasoning|tool)/i.test(`${title} ${desc}`)) continue;

    const cleanDesc = stripMarkdownNoise(desc);
    const affected = extractModelIds(`${title} ${desc}`);
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 44);

    events.push({
      id: `evt_kimi_doc_${slug}`,
      slug: `kimi-${slug}`,
      provider: "kimi",
      category: /pricing|cache/i.test(cleanDesc) ? "pricing" : "new_model",
      severity: "info",
      confidence: "medium",
      models_affected: affected,
      title: stripMarkdownNoise(title),
      agent_summary: cleanDesc.length <= 220 ? cleanDesc : `${cleanDesc.slice(0, 217)}...`,
      evidence_quote: cleanDesc.slice(0, 200),
      source_url: url,
      published_at: detectedAt.slice(0, 10),
      detected_at: detectedAt,
    });
    if (events.length >= 10) break;
  }

  return { models, events };
}

export const kimiAdapter: ProviderAdapter = {
  id: "kimi",
  displayName: "Moonshot AI (Kimi)",
  primaryUrls: [KIMI_LLMS_URL, KIMI_PRICING_MD_URL],
  async ingest(options): Promise<ProviderIngestionResult> {
    const now = options?.now ? options.now() : new Date();
    const detectedAt = now.toISOString();
    const sources: Record<string, HttpCacheMetadata> = {};

    const [llmsRes, priceRes] = await Promise.allSettled([
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

    const llmsText = llmsRes.status === "fulfilled" && llmsRes.value.body ? llmsRes.value.body : "";
    const pricingMd =
      priceRes.status === "fulfilled" && priceRes.value.body ? priceRes.value.body : "";

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

    const parsed = parseKimiDocs(llmsText, pricingMd, detectedAt);
    return { provider: "kimi", models: parsed.models, events: parsed.events, sources };
  },
};
