#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = resolve(ROOT_DIR, "data", "seed.json");
const REQUIRED_PROVIDERS = ["gemini", "claude", "openai", "deepseek", "kimi"];

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const { CatalogSnapshotSchema, ingestFullCatalog } = await import("../dist/index.js");

  if (checkOnly) {
    const raw = readFileSync(SEED_PATH, "utf8");
    const snapshot = CatalogSnapshotSchema.parse(JSON.parse(raw));

    for (const provider of REQUIRED_PROVIDERS) {
      const count = snapshot.models.filter((m) => m.provider === provider).length;
      if (count === 0) {
        throw new Error(`Seed check failed: provider '${provider}' has 0 models.`);
      }
    }

    const opus55 = snapshot.models.find((m) => m.canonical_id === "claude-opus-5-5");
    if (opus55?.context_window !== 1_000_000) {
      throw new Error(
        `Seed check failed: expected claude-opus-5-5 context_window=1000000, got ${opus55?.context_window ?? "missing"}.`,
      );
    }

    const deprecatedCount = snapshot.models.filter((m) => m.status === "deprecated").length;
    if (deprecatedCount === 0) {
      throw new Error("Seed check failed: expected at least 1 deprecated model entry.");
    }

    process.stdout.write(
      `[OK] Seed verified: ${snapshot.models.length} models (${deprecatedCount} deprecated), ${snapshot.events.length} events.\n`,
    );
    return;
  }

  const { snapshot } = await ingestFullCatalog();
  const bundledModels = snapshot.models.map((m) => ({
    ...m,
    source_origin: "bundled_seed",
  }));

  const validated = CatalogSnapshotSchema.parse({
    ...snapshot,
    stale: false,
    models: bundledModels,
  });

  for (const provider of REQUIRED_PROVIDERS) {
    const count = validated.models.filter((m) => m.provider === provider).length;
    if (count === 0) {
      throw new Error(`Live seed generation failed: provider '${provider}' returned 0 models.`);
    }
  }

  mkdirSync(dirname(SEED_PATH), { recursive: true });
  writeFileSync(SEED_PATH, JSON.stringify(validated), "utf8");
  process.stdout.write(
    `[OK] Generated data/seed.json (${validated.models.length} models, ${validated.events.length} events).\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
