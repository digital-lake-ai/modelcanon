import { fetchResource } from "../http/fetcher.js";
import type { ProviderId } from "../schema/models.js";

export interface NativeModelDiscovery {
  provider: ProviderId;
  modelIds: string[];
  sourceUrl: string;
}

export async function fetchNativeProviderModels(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): Promise<NativeModelDiscovery[]> {
  const tasks: Array<Promise<NativeModelDiscovery | null>> = [];

  if (env.GEMINI_API_KEY?.trim()) {
    const key = env.GEMINI_API_KEY.trim();
    const url = "https://generativelanguage.googleapis.com/v1beta/models";
    tasks.push(
      fetchModelsEndpoint(
        "gemini",
        url,
        url,
        { "x-goog-api-key": key },
        (json) => {
          const list = (json as { models?: Array<{ name?: string }> }).models ?? [];
          return list.map((m) => m.name?.replace(/^models\//, "") ?? "").filter(Boolean);
        },
        fetchImpl,
      ),
    );
  }

  if (env.ANTHROPIC_API_KEY?.trim()) {
    tasks.push(
      fetchModelsEndpoint(
        "claude",
        "https://api.anthropic.com/v1/models",
        "https://api.anthropic.com/v1/models",
        {
          "x-api-key": env.ANTHROPIC_API_KEY.trim(),
          "anthropic-version": "2023-06-01",
        },
        extractDataIds,
        fetchImpl,
      ),
    );
  }

  if (env.OPENAI_API_KEY?.trim()) {
    tasks.push(
      fetchModelsEndpoint(
        "openai",
        "https://api.openai.com/v1/models",
        "https://api.openai.com/v1/models",
        { Authorization: `Bearer ${env.OPENAI_API_KEY.trim()}` },
        extractDataIds,
        fetchImpl,
      ),
    );
  }

  if (env.DEEPSEEK_API_KEY?.trim()) {
    tasks.push(
      fetchModelsEndpoint(
        "deepseek",
        "https://api.deepseek.com/models",
        "https://api.deepseek.com/models",
        { Authorization: `Bearer ${env.DEEPSEEK_API_KEY.trim()}` },
        extractDataIds,
        fetchImpl,
      ),
    );
  }

  if (env.MOONSHOT_API_KEY?.trim()) {
    tasks.push(
      fetchModelsEndpoint(
        "kimi",
        "https://api.moonshot.ai/v1/models",
        "https://api.moonshot.ai/v1/models",
        { Authorization: `Bearer ${env.MOONSHOT_API_KEY.trim()}` },
        extractDataIds,
        fetchImpl,
      ),
    );
  }

  const results = await Promise.all(tasks);
  return results.filter((item): item is NativeModelDiscovery => item !== null);
}

async function fetchModelsEndpoint(
  provider: ProviderId,
  publicUrl: string,
  requestUrl: string,
  headers: Record<string, string>,
  parseIds: (json: unknown) => string[],
  fetchImpl?: typeof fetch,
): Promise<NativeModelDiscovery | null> {
  try {
    const res = await fetchResource(requestUrl, {
      accept: "application/json",
      headers,
      timeoutMs: 5_000,
      maxBytes: 2 * 1024 * 1024,
      fetchImpl,
    });
    if (!res.body) return null;
    const parsed = JSON.parse(res.body) as unknown;
    return {
      provider,
      modelIds: parseIds(parsed),
      sourceUrl: publicUrl,
    };
  } catch {
    return null;
  }
}

function extractDataIds(json: unknown): string[] {
  const data = (json as { data?: Array<{ id?: string }> }).data ?? [];
  return data.map((item) => item.id?.trim() ?? "").filter(Boolean);
}
