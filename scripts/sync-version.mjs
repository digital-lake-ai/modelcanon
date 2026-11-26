#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relPath) {
  return JSON.parse(readFileSync(resolve(ROOT_DIR, relPath), "utf8"));
}

function writeJson(relPath, data) {
  writeFileSync(resolve(ROOT_DIR, relPath), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function extractPyprojectVersion(content) {
  const match = /^version\s*=\s*"([^"]+)"/m.exec(content);
  return match?.[1] ?? null;
}

function extractPythonInitVersion(content) {
  const match = /^__version__\s*=\s*"([^"]+)"/m.exec(content);
  return match?.[1] ?? null;
}

function extractCliVersion(content) {
  const match = /function getCliVersion\(\): string \{\s*return "([^"]+)";\s*\}/m.exec(content);
  return match?.[1] ?? null;
}

function extractMcpServerVersion(content) {
  const match = /export const MCP_SERVER_VERSION = "([^"]+)";/m.exec(content);
  return match?.[1] ?? null;
}

function extractFetcherVersion(content) {
  const match = /"User-Agent":\s*"ModelCanon\/([^"\s]+)\s+/m.exec(content);
  return match?.[1] ?? null;
}

function extractCacheVersion(content) {
  const match = /export const CACHE_PACKAGE_VERSION = "([^"]+)";/m.exec(content);
  return match?.[1] ?? null;
}

function extractDockerfileVersion(content) {
  const match = /org\.opencontainers\.image\.version="([^"]+)"/m.exec(content);
  return match?.[1] ?? null;
}

function readVersionSurfaces() {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const server = readJson("server.json");
  const pyproject = readFileSync(resolve(ROOT_DIR, "pyproject.toml"), "utf8");
  const pyInit = readFileSync(resolve(ROOT_DIR, "python/modelcanon_mcp/__init__.py"), "utf8");
  const cli = readFileSync(resolve(ROOT_DIR, "src/cli.ts"), "utf8");
  const mcpServer = readFileSync(resolve(ROOT_DIR, "src/mcp/server.ts"), "utf8");
  const fetcher = readFileSync(resolve(ROOT_DIR, "src/http/fetcher.ts"), "utf8");
  const cache = readFileSync(resolve(ROOT_DIR, "src/store/cache.ts"), "utf8");
  const dockerfile = readFileSync(resolve(ROOT_DIR, "Dockerfile"), "utf8");

  return {
    "package.json": pkg.version ?? null,
    "package-lock.json": lock.version ?? null,
    "package-lock.json#packages['']": lock.packages?.[""]?.version ?? null,
    "server.json": server.version ?? null,
    "server.json#packages": Array.isArray(server.packages)
      ? server.packages.map((p) => p.version ?? null)
      : [],
    "pyproject.toml": extractPyprojectVersion(pyproject),
    "python/modelcanon_mcp/__init__.py": extractPythonInitVersion(pyInit),
    "src/cli.ts": extractCliVersion(cli),
    "src/mcp/server.ts": extractMcpServerVersion(mcpServer),
    "src/http/fetcher.ts": extractFetcherVersion(fetcher),
    "src/store/cache.ts": extractCacheVersion(cache),
    Dockerfile: extractDockerfileVersion(dockerfile),
  };
}

function checkVersionParity() {
  const surfaces = readVersionSurfaces();
  const target = surfaces["package.json"];
  const mismatches = [];

  if (!target || typeof target !== "string") {
    throw new Error("package.json is missing a valid version string.");
  }

  for (const [key, value] of Object.entries(surfaces)) {
    if (Array.isArray(value)) {
      value.forEach((v, idx) => {
        if (v !== target) {
          mismatches.push(`${key}[${idx}]: expected '${target}', found '${v}'`);
        }
      });
    } else if (value !== target) {
      mismatches.push(`${key}: expected '${target}', found '${value}'`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Version parity check failed:\n- ${mismatches.join("\n- ")}`);
  }

  process.stdout.write(`[OK] All 10 version surfaces match ${target}.\n`);
}

function syncVersions(targetVersion) {
  const pkg = readJson("package.json");
  pkg.version = targetVersion;
  writeJson("package.json", pkg);

  const lock = readJson("package-lock.json");
  lock.version = targetVersion;
  if (lock.packages?.[""]) {
    lock.packages[""].version = targetVersion;
  }
  writeJson("package-lock.json", lock);

  const server = readJson("server.json");
  server.version = targetVersion;
  if (Array.isArray(server.packages)) {
    for (const p of server.packages) {
      p.version = targetVersion;
    }
  }
  writeJson("server.json", server);

  const pyprojectPath = resolve(ROOT_DIR, "pyproject.toml");
  const pyproject = readFileSync(pyprojectPath, "utf8");
  writeFileSync(
    pyprojectPath,
    pyproject.replace(/^version\s*=\s*"[^"]+"/m, `version = "${targetVersion}"`),
    "utf8",
  );

  const pyInitPath = resolve(ROOT_DIR, "python/modelcanon_mcp/__init__.py");
  const pyInit = readFileSync(pyInitPath, "utf8");
  writeFileSync(
    pyInitPath,
    pyInit.replace(/^__version__\s*=\s*"[^"]+"/m, `__version__ = "${targetVersion}"`),
    "utf8",
  );

  const cliPath = resolve(ROOT_DIR, "src/cli.ts");
  const cli = readFileSync(cliPath, "utf8");
  writeFileSync(
    cliPath,
    cli.replace(
      /(function getCliVersion\(\): string \{\s*return ")[^"]+(";)/m,
      `$1${targetVersion}$2`,
    ),
    "utf8",
  );

  const mcpServerPath = resolve(ROOT_DIR, "src/mcp/server.ts");
  const mcpServer = readFileSync(mcpServerPath, "utf8");
  writeFileSync(
    mcpServerPath,
    mcpServer.replace(/(export const MCP_SERVER_VERSION = ")[^"]+(";)/m, `$1${targetVersion}$2`),
    "utf8",
  );

  const fetcherPath = resolve(ROOT_DIR, "src/http/fetcher.ts");
  const fetcher = readFileSync(fetcherPath, "utf8");
  writeFileSync(
    fetcherPath,
    fetcher.replace(/("User-Agent":\s*"ModelCanon\/)[^"\s]+(\s+)/m, `$1${targetVersion}$2`),
    "utf8",
  );

  const cachePath = resolve(ROOT_DIR, "src/store/cache.ts");
  const cache = readFileSync(cachePath, "utf8");
  writeFileSync(
    cachePath,
    cache.replace(/(export const CACHE_PACKAGE_VERSION = ")[^"]+(";)/m, `$1${targetVersion}$2`),
    "utf8",
  );

  const dockerfilePath = resolve(ROOT_DIR, "Dockerfile");
  const dockerfile = readFileSync(dockerfilePath, "utf8");
  writeFileSync(
    dockerfilePath,
    dockerfile.replace(/(org\.opencontainers\.image\.version=")[^"]+(")/m, `$1${targetVersion}$2`),
    "utf8",
  );

  process.stdout.write(`[OK] Synchronized all 10 surfaces to ${targetVersion}.\n`);
}

const args = process.argv.slice(2);
if (args.includes("--check")) {
  checkVersionParity();
} else {
  const target = args.find((a) => !a.startsWith("-")) ?? readJson("package.json").version;
  syncVersions(target);
  checkVersionParity();
}
