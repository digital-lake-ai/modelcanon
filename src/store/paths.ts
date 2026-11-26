import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

export function getCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathImpl = platform === "win32" ? win32 : posix;
  const override = env.MODELCANON_CACHE_DIR?.trim();
  if (override) {
    return override;
  }

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || pathImpl.join(homedir(), "AppData", "Local");
    return pathImpl.join(localAppData, "modelcanon", "cache");
  }

  if (platform === "darwin") {
    return pathImpl.join(homedir(), "Library", "Caches", "modelcanon");
  }

  const xdgCache = env.XDG_CACHE_HOME?.trim() || pathImpl.join(homedir(), ".cache");
  return pathImpl.join(xdgCache, "modelcanon");
}

export function getSnapshotCachePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathImpl = platform === "win32" ? win32 : posix;
  return pathImpl.join(getCacheDir(env, platform), "catalog-snapshot.json");
}

export function getBundledSeedPath(): string {
  return fileURLToPath(new URL("../../data/seed.json", import.meta.url));
}
