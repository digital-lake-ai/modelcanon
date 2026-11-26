#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { auditModelId } from "./domain/query.js";
import { startMcpServer } from "./mcp/server.js";
import { ingestFullCatalog } from "./registry/providers.js";
import { CatalogCacheStore } from "./store/cache.js";

export function getCliVersion(): string {
  return "0.1.2";
}

function printHelp(): void {
  process.stdout.write(
    [
      `ModelCanon CLI (v${getCliVersion()})`,
      "",
      "Usage:",
      "  modelcanon [mcp]                 Start the stdio MCP server (default)",
      "  modelcanon audit <id> [--json]   Audit a single AI model identifier",
      "  modelcanon sync [--json]         Force live refresh of the local catalog cache",
      "  modelcanon --version | -v        Print version",
      "  modelcanon --help | -h           Print help",
      "",
    ].join("\n"),
  );
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${getCliVersion()}\n`);
    return 0;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return 0;
  }

  if (!command || command === "mcp") {
    await startMcpServer();
    return 0;
  }

  if (command === "audit") {
    const modelId = rest.find((arg) => !arg.startsWith("-"));
    if (!modelId) {
      process.stderr.write("Usage: modelcanon audit <model_id> [--json]\n");
      return 1;
    }
    const asJson = rest.includes("--json");
    const store = new CatalogCacheStore();
    const snapshot = await store.resolveSnapshot({
      mode: "cli",
      refresh: (previousSources) => ingestFullCatalog({ previousSources }),
    });
    const result = auditModelId(snapshot, modelId);
    if (asJson) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(
        `${result.queried_id} => ${result.status} (canonical: ${result.canonical_id ?? "none"}, shutdown: ${result.shutdown_date ?? "none"}, replacement: ${result.replacement_id ?? "none"})\n`,
      );
    }
    return 0;
  }

  if (command === "sync") {
    const asJson = rest.includes("--json");
    const store = new CatalogCacheStore();
    const previousSources = store.readEnvelope()?.sources ?? {};
    const { snapshot, sources } = await ingestFullCatalog({ previousSources });
    const { persistedToDisk } = store.writeEnvelope(snapshot, sources);
    const summary = {
      generated_at: snapshot.generated_at,
      models: snapshot.models.length,
      events: snapshot.events.length,
      persisted_to_disk: persistedToDisk,
    };
    process.stdout.write(
      asJson
        ? `${JSON.stringify(summary, null, 2)}\n`
        : `Synced ${summary.models} models and ${summary.events} updates.\n`,
    );
    return 0;
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  printHelp();
  return 1;
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  runCli().then(
    (code) => {
      if (code !== 0) process.exitCode = code;
    },
    (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Fatal error: ${msg}\n`);
      process.exitCode = 1;
    },
  );
}
