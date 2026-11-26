import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type CatalogSnapshot, CatalogSnapshotSchema } from "../schema/models.js";
import { getBundledSeedPath, getSnapshotCachePath } from "./paths.js";

export const CACHE_PACKAGE_VERSION = "0.1.2";

export interface HttpCacheMetadata {
  etag: string | null;
  lastModified: string | null;
  sha256: string | null;
}

export interface PersistedCacheEnvelope {
  schema_version: "1.0.0";
  package_version?: string;
  cached_at: string;
  ttl_seconds: number;
  sources: Record<string, HttpCacheMetadata>;
  snapshot: CatalogSnapshot;
}

export interface CacheStoreOptions {
  cacheFilePath?: string;
  seedFilePath?: string;
  ttlSeconds?: number;
  failureCooldownMs?: number;
  now?: () => Date;
  offlineFallback?: boolean;
}

const DEFAULT_TTL_SECONDS = 10_800; // 3 hours
const DEFAULT_FAILURE_COOLDOWN_MS = 300_000; // 5 minutes

export class CatalogCacheStore {
  private memoryEnvelope: PersistedCacheEnvelope | null = null;
  private inFlightRefresh: Promise<{
    snapshot: CatalogSnapshot;
    sources: Record<string, HttpCacheMetadata>;
  }> | null = null;
  private lastFailureAtMs: number | null = null;
  private readonly cacheFilePath: string;
  private readonly seedFilePath: string;
  private readonly ttlSeconds: number;
  private readonly failureCooldownMs: number;
  private readonly now: () => Date;
  private readonly offlineFallback: boolean;

  constructor(options: CacheStoreOptions = {}) {
    this.cacheFilePath = options.cacheFilePath ?? getSnapshotCachePath();
    this.seedFilePath = options.seedFilePath ?? getBundledSeedPath();
    const envTtl = Number.parseInt(process.env.MODELCANON_TTL_SECONDS ?? "", 10);
    this.ttlSeconds =
      options.ttlSeconds ?? (Number.isFinite(envTtl) && envTtl > 0 ? envTtl : DEFAULT_TTL_SECONDS);
    this.failureCooldownMs = options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS;
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
      package_version: CACHE_PACKAGE_VERSION,
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

  async drain(): Promise<void> {
    if (this.inFlightRefresh) {
      await this.inFlightRefresh.catch(() => undefined);
    }
  }

  async resolveSnapshot(options: {
    refresh: (
      previousSources: Record<string, HttpCacheMetadata>,
    ) => Promise<{ snapshot: CatalogSnapshot; sources: Record<string, HttpCacheMetadata> }>;
    revalidateBudgetMs?: number;
    mode?: "server" | "cli";
  }): Promise<CatalogSnapshot> {
    const cached = this.readEnvelope();
    if (cached && !this.isExpired(cached)) {
      return { ...cached.snapshot, stale: false };
    }

    const seed = cached?.snapshot ?? this.readBundledSeed();

    if (
      options.mode !== "cli" &&
      this.lastFailureAtMs !== null &&
      this.now().getTime() - this.lastFailureAtMs < this.failureCooldownMs &&
      seed
    ) {
      return { ...seed, stale: true };
    }

    if (!this.inFlightRefresh) {
      const previousSources = cached?.sources ?? {};
      const pending = options
        .refresh(previousSources)
        .then((refreshed) => {
          const { envelope } = this.writeEnvelope(refreshed.snapshot, refreshed.sources);
          this.lastFailureAtMs = null;
          return {
            snapshot: { ...envelope.snapshot, stale: false },
            sources: envelope.sources,
          };
        })
        .catch((err) => {
          this.lastFailureAtMs = this.now().getTime();
          throw err;
        })
        .finally(() => {
          if (this.inFlightRefresh === pending) {
            this.inFlightRefresh = null;
          }
        });
      // Prevent unhandledRejection if background refresh fails after server timeout
      pending.catch(() => undefined);
      this.inFlightRefresh = pending;
    }

    if (options.mode === "cli") {
      try {
        const res = await this.inFlightRefresh;
        return { ...res.snapshot, stale: false };
      } catch {
        if (seed) {
          return { ...seed, stale: true };
        }
        throw new Error("No cached catalog, bundled seed, or reachable upstream available.");
      }
    }

    const budgetMs = options.revalidateBudgetMs ?? 1_500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const refreshed = await Promise.race([
        this.inFlightRefresh,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Revalidation budget exceeded")), budgetMs);
          timer.unref?.();
        }),
      ]);
      return { ...refreshed.snapshot, stale: false };
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
  if (candidate.package_version !== CACHE_PACKAGE_VERSION) return false;
  if (typeof candidate.cached_at !== "string") return false;
  if (typeof candidate.ttl_seconds !== "number") return false;
  const snap = CatalogSnapshotSchema.safeParse(candidate.snapshot);
  return snap.success;
}
