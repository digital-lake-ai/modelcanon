import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ingestFullCatalog } from "../registry/providers.js";
import { CatalogCacheStore } from "../store/cache.js";
import { registerModelCanonTools, type SnapshotProviderFn } from "./tools.js";

export const MCP_SERVER_NAME = "modelcanon";
export const MCP_SERVER_VERSION = "0.1.2";

export interface CreateServerOptions {
  cacheStore?: CatalogCacheStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  getSnapshot?: SnapshotProviderFn;
}

export function createModelCanonServer(options: CreateServerOptions = {}): McpServer {
  const now = options.now ?? (() => new Date());
  const cacheStore = options.cacheStore ?? new CatalogCacheStore({ now });

  const getSnapshot: SnapshotProviderFn =
    options.getSnapshot ??
    (() =>
      cacheStore.resolveSnapshot({
        refresh: (previousSources) =>
          ingestFullCatalog({
            fetchImpl: options.fetchImpl,
            now,
            previousSources,
          }),
      }));

  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  registerModelCanonTools(server, getSnapshot, now);

  server.registerResource(
    "catalog-summary",
    "modelcanon://catalog/summary",
    {
      title: "ModelCanon Catalog Summary",
      description: "Live summary of tracked providers, model counts, and cache freshness.",
      mimeType: "application/json",
    },
    async (uri) => {
      const snapshot = await getSnapshot();
      const summary = {
        schema_version: snapshot.schema_version,
        generated_at: snapshot.generated_at,
        stale: snapshot.stale,
        total_models: snapshot.models.length,
        total_events: snapshot.events.length,
        providers: ["gemini", "claude", "openai", "deepseek", "kimi"],
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "upcoming-deprecations",
    "modelcanon://deprecations/upcoming",
    {
      title: "Upcoming Model Deprecations",
      description: "Models currently marked deprecated or scheduled for shutdown.",
      mimeType: "application/json",
    },
    async (uri) => {
      const snapshot = await getSnapshot();
      const deprecated = snapshot.models
        .filter((m) => m.status === "deprecated" || m.shutdown_date !== null)
        .map((m) => ({
          canonical_id: m.canonical_id,
          provider: m.provider,
          status: m.status,
          shutdown_date: m.shutdown_date,
          replacement_id: m.replacement_id,
          official_url: m.official_url,
        }));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(deprecated, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

export async function startMcpServer(options: CreateServerOptions = {}): Promise<void> {
  const server = createModelCanonServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
