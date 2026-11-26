#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_PATH = resolve(ROOT_DIR, "data", "seed.json");
const REQUIRED_PROVIDERS = ["gemini", "claude", "openai", "deepseek", "kimi"];

function assertSnapshotIntegrity(snapshot) {
  const todayIso = snapshot.generated_at.slice(0, 10);

  for (const provider of REQUIRED_PROVIDERS) {
    const count = snapshot.models.filter((m) => m.provider === provider).length;
    if (count < 3) {
      throw new Error(`Seed integrity failed: provider '${provider}' has only ${count} model(s).`);
    }
  }

  for (const model of snapshot.models) {
    const id = model.canonical_id;
    if (
      /\.(?:md|mdx|txt|html?|json|xml|ya?ml)$/i.test(id) ||
      id.includes(":") ||
      !/[-0-9]/.test(id)
    ) {
      throw new Error(`Seed integrity failed: invalid canonical_id '${id}'.`);
    }
    if (
      model.status === "active" &&
      model.shutdown_date !== null &&
      model.shutdown_date <= todayIso
    ) {
      throw new Error(
        `Seed integrity failed: '${id}' has status='active' with past shutdown_date '${model.shutdown_date}'.`,
      );
    }
  }

  for (const evt of snapshot.events) {
    if (evt.published_at > todayIso) {
      throw new Error(
        `Seed integrity failed: event '${evt.id}' has future published_at '${evt.published_at}' (> ${todayIso}).`,
      );
    }
  }

  const opus55 = snapshot.models.find((m) => m.canonical_id === "claude-opus-5-5");
  if (opus55?.context_window !== 1_000_000) {
    throw new Error(
      `Seed integrity failed: expected claude-opus-5-5 context_window=1000000, got ${opus55?.context_window ?? "missing"}.`,
    );
  }

  const kimiK31 = snapshot.models.find((m) => m.canonical_id === "kimi-k3.1-pro");
  if (kimiK31?.status !== "active") {
    throw new Error(
      `Seed integrity failed: expected kimi-k3.1-pro status='active', got '${kimiK31?.status ?? "missing"}'.`,
    );
  }

  const deepseekChat = snapshot.models.find((m) => m.canonical_id === "deepseek-chat");
  if (deepseekChat && deepseekChat.status === "active" && deepseekChat.shutdown_date !== null) {
    throw new Error("Seed integrity failed: deepseek-chat cannot be active with a shutdown_date.");
  }

  const deprecatedCount = snapshot.models.filter((m) => m.status === "deprecated").length;
  if (deprecatedCount === 0) {
    throw new Error("Seed integrity failed: expected at least 1 deprecated model entry.");
  }

  return deprecatedCount;
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const { CatalogSnapshotSchema, ingestFullCatalog } = await import("../dist/index.js");

  if (checkOnly) {
    const raw = readFileSync(SEED_PATH, "utf8");
    const snapshot = CatalogSnapshotSchema.parse(JSON.parse(raw));
    const deprecatedCount = assertSnapshotIntegrity(snapshot);

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

  assertSnapshotIntegrity(validated);

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
