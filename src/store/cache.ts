import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CatalogSnapshot, CatalogSnapshotSchema } from "../schema/models.js";
import { getBundledSeedPath, getSnapshotCachePath } from "./paths.js";

export interface HttpCacheMetadata {
  etag: string | null;
  lastModified: string | null;
  sha256: string | null;
}

export interface PersistedCacheEnvelope {
  schema_version: "1.0.0";
  cached_at: string;
  ttl_seconds: number;
  sources: Record<string, HttpCacheMetadata>;
  snapshot: CatalogSnapshot;
}

export interface CacheStoreOptions {
  cacheFilePath?: string;
  seedFilePath?: string;
  ttlSeconds?: number;
  now?: () => Date;
  offlineFallback?: boolean;
}

const DEFAULT_TTL_SECONDS = 10_800; // 3 hours

export class CatalogCacheStore {
  private memoryEnvelope: PersistedCacheEnvelope | null = null;
  private readonly cacheFilePath: string;
  private readonly seedFilePath: string;
  private readonly ttlSeconds: number;
  private readonly now: () => Date;
  private readonly offlineFallback: boolean;

  constructor(options: CacheStoreOptions = {}) {
    this.cacheFilePath = options.cacheFilePath ?? getSnapshotCachePath();
    this.seedFilePath = options.seedFilePath ?? getBundledSeedPath();
    const envTtl = Number.parseInt(process.env.MODELCANON_TTL_SECONDS ?? "", 10);
    this.ttlSeconds =
      options.ttlSeconds ?? (Number.isFinite(envTtl) && envTtl > 0 ? envTtl : DEFAULT_TTL_SECONDS);
    this.now = options.now ?? (() => new Date());
    this.offlineFallback =
      options.offlineFallback ?? process.env.MODELCANON_OFFLINE_FALLBACK === "1";
  }

  readEnvelope(): PersistedCacheEnvelope | null {
    if (this.memoryEnvelope) {
      return this.memoryEnvelope;
    }

    try {
      const raw = readFileSync(this.cacheFilePath, "utf8");
      const parsedJson = JSON.parse(raw) as unknown;
      if (!isValidEnvelope(parsedJson)) {
        return null;
      }
      this.memoryEnvelope = parsedJson;
      return parsedJson;
    } catch {
      return null;
    }
  }

  writeEnvelope(
    snapshot: CatalogSnapshot,
    sources: Record<string, HttpCacheMetadata> = {},
  ): { persistedToDisk: boolean; envelope: PersistedCacheEnvelope } {
    const validatedSnapshot = CatalogSnapshotSchema.parse(snapshot);
    const envelope: PersistedCacheEnvelope = {
      schema_version: "1.0.0",
      cached_at: this.now().toISOString(),
      ttl_seconds: this.ttlSeconds,
      sources,
      snapshot: validatedSnapshot,
    };

    this.memoryEnvelope = envelope;

    if (this.offlineFallback) {
      return { persistedToDisk: false, envelope };
    }

    const dir = dirname(this.cacheFilePath);
    const tmpPath = join(dir, `.tmp-${process.pid}-${Date.now()}.json`);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(tmpPath, JSON.stringify(envelope), "utf8");
      renameSync(tmpPath, this.cacheFilePath);
      return { persistedToDisk: true, envelope };
    } catch {
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        // Ignore cleanup failure on read-only filesystems
      }
      return { persistedToDisk: false, envelope };
    }
  }

  isExpired(envelope: PersistedCacheEnvelope): boolean {
    const cachedMs = Date.parse(envelope.cached_at);
    if (!Number.isFinite(cachedMs)) {
      return true;
    }
    const ageSeconds = (this.now().getTime() - cachedMs) / 1000;
    return ageSeconds >= envelope.ttl_seconds;
  }

  readBundledSeed(): CatalogSnapshot | null {
    try {
      const raw = readFileSync(this.seedFilePath, "utf8");
      const parsed = CatalogSnapshotSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async resolveSnapshot(options: {
    refresh: (
      previousSources: Record<string, HttpCacheMetadata>,
    ) => Promise<{ snapshot: CatalogSnapshot; sources: Record<string, HttpCacheMetadata> }>;
    revalidateBudgetMs?: number;
  }): Promise<CatalogSnapshot> {
    const cached = this.readEnvelope();
    if (cached && !this.isExpired(cached)) {
      return { ...cached.snapshot, stale: false };
    }

    const seed = cached?.snapshot ?? this.readBundledSeed();
    const budgetMs = options.revalidateBudgetMs ?? 1_500;
    const previousSources = cached?.sources ?? {};

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const refreshed = await Promise.race([
        options.refresh(previousSources),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Revalidation budget exceeded")), budgetMs);
        }),
      ]);
      const { envelope } = this.writeEnvelope(refreshed.snapshot, refreshed.sources);
      return { ...envelope.snapshot, stale: false };
    } catch {
      if (seed) {
        return { ...seed, stale: true };
      }
      throw new Error("No cached catalog, bundled seed, or reachable upstream available.");
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

function isValidEnvelope(value: unknown): value is PersistedCacheEnvelope {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.schema_version !== "1.0.0") return false;
  if (typeof candidate.cached_at !== "string") return false;
  if (typeof candidate.ttl_seconds !== "number") return false;
  const snap = CatalogSnapshotSchema.safeParse(candidate.snapshot);
  return snap.success;
}
