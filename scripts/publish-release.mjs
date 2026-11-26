#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_SLUG = "digital-lake-ai/modelcanon";
const ENVIRONMENT_NAME = "Digital-Lake-ModelCanon";

function isCmdShim(bin) {
  return process.platform === "win32" && (bin === "npm" || bin === "npx");
}

function runCommand(bin, args, options = {}) {
  const cwd = options.cwd ?? ROOT_DIR;
  const capture = options.capture ?? false;
  const stdio = capture ? ["ignore", "pipe", "pipe"] : "inherit";

  if (isCmdShim(bin)) {
    return execFileSync("cmd.exe", ["/d", "/s", "/c", `${bin}.cmd`, ...args], {
      cwd,
      encoding: "utf8",
      stdio,
      env: options.env ?? process.env,
    });
  }

  return execFileSync(bin, args, {
    cwd,
    encoding: "utf8",
    stdio,
    env: options.env ?? process.env,
  });
}

function tryCommand(bin, args) {
  try {
    const out = runCommand(bin, args, { capture: true });
    return { ok: true, output: (out ?? "").trim() };
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err ? String(err.stderr ?? "") : "";
    const stdout =
      err && typeof err === "object" && "stdout" in err ? String(err.stdout ?? "") : "";
    const msg =
      stderr.trim() || stdout.trim() || (err instanceof Error ? err.message : String(err));
    return { ok: false, output: msg };
  }
}

function readPackageMetadata() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT_DIR, "package.json"), "utf8"));
  return {
    name: String(pkg.name),
    version: String(pkg.version),
    description: String(pkg.description),
    homepage: String(pkg.homepage ?? `https://github.com/${REPO_SLUG}#readme`),
    keywords: Array.isArray(pkg.keywords) ? pkg.keywords.map(String) : [],
  };
}

function resolveMcpPublisherBin() {
  const envBin = process.env.MCP_PUBLISHER_BIN?.trim();
  if (envBin && existsSync(envBin)) {
    return envBin;
  }
  const check = tryCommand("mcp-publisher", ["--help"]);
  return check.ok ? "mcp-publisher" : null;
}

function runPreflight() {
  process.stdout.write("=== ModelCanon Release Preflight ===\n");

  runCommand("npm", ["run", "version:check"]);
  runCommand("npm", ["run", "seed:check"]);
  runCommand("npm", ["run", "lint"]);
  runCommand("npm", ["run", "build"]);
  runCommand("npm", ["test"]);

  const packRes = tryCommand("npm", ["pack", "--dry-run"]);
  if (!packRes.ok) {
    throw new Error(`npm pack --dry-run failed: ${packRes.output}`);
  }
  const tarballLine =
    packRes.output
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? "tarball verified";
  process.stdout.write(`[PASS] npm pack --dry-run: ${tarballLine}\n`);

  runCommand("uv", ["build", "--out-dir", "dist-pypi"]);
  const distPypiFiles = readdirSync(resolve(ROOT_DIR, "dist-pypi"));
  if (distPypiFiles.length < 2) {
    throw new Error("Expected both sdist and wheel in dist-pypi/");
  }
  process.stdout.write(`[PASS] uv build: ${distPypiFiles.join(", ")}\n`);

  process.stdout.write("\n=== Channel Auth Readiness ===\n");

  const ghUser = tryCommand("gh", ["api", "user", "--jq", ".login"]);
  const ghOrgs = tryCommand("gh", ["api", "user/orgs", "--jq", ".[].login"]);
  const hasOrg = ghOrgs.ok && ghOrgs.output.split(/\r?\n/).includes("digital-lake-ai");
  if (ghUser.ok && hasOrg) {
    process.stdout.write(
      `[READY] GitHub CLI: authenticated as '${ghUser.output}' with org 'digital-lake-ai'\n`,
    );
  } else {
    process.stdout.write(
      `[ACTION_REQUIRED] GitHub CLI: ${ghUser.ok ? `user '${ghUser.output}' lacks digital-lake-ai org` : ghUser.output}\n`,
    );
  }

  const npmUser = tryCommand("npm", ["whoami"]);
  if (npmUser.ok) {
    process.stdout.write(`[READY] npm registry: logged in as '${npmUser.output}'\n`);
  } else {
    process.stdout.write("[ACTION_REQUIRED] npm registry: not logged in (run 'npm login')\n");
  }

  if (process.env.UV_PUBLISH_TOKEN?.trim()) {
    process.stdout.write("[READY] PyPI: UV_PUBLISH_TOKEN is set for direct upload\n");
  } else {
    process.stdout.write(
      "[INFO] PyPI: UV_PUBLISH_TOKEN unset (use PyPI Pending Publisher OIDC in release.yml or export UV_PUBLISH_TOKEN)\n",
    );
  }

  const mcpPub = resolveMcpPublisherBin();
  if (mcpPub) {
    runCommand(mcpPub, ["validate", "server.json"]);
    process.stdout.write(`[READY] mcp-publisher validated server.json via: ${mcpPub}\n`);
  } else {
    process.stdout.write(
      "[INFO] mcp-publisher not on PATH (handled via GitHub OIDC in release.yml or set MCP_PUBLISHER_BIN)\n",
    );
  }
}

function runGithubBootstrap() {
  const meta = readPackageMetadata();
  const repoView = tryCommand("gh", ["repo", "view", REPO_SLUG, "--json", "name"]);

  if (!repoView.ok) {
    process.stdout.write(`Creating public GitHub repository ${REPO_SLUG}...\n`);
    runCommand("gh", [
      "repo",
      "create",
      REPO_SLUG,
      "--public",
      "--description",
      meta.description,
      "--homepage",
      meta.homepage,
    ]);
  } else {
    process.stdout.write(`Repository ${REPO_SLUG} already exists; updating metadata...\n`);
  }

  const editArgs = [
    "repo",
    "edit",
    REPO_SLUG,
    "--description",
    meta.description,
    "--homepage",
    meta.homepage,
    "--delete-branch-on-merge",
  ];
  for (const topic of meta.keywords.slice(0, 12)) {
    editArgs.push("--add-topic", topic);
  }
  runCommand("gh", editArgs);

  runCommand("gh", [
    "api",
    "--method",
    "PUT",
    `repos/${REPO_SLUG}/environments/${ENVIRONMENT_NAME}`,
  ]);

  const remoteCheck = tryCommand("git", ["remote", "get-url", "origin"]);
  const remoteUrl = `https://github.com/${REPO_SLUG}.git`;
  if (!remoteCheck.ok) {
    runCommand("git", ["remote", "add", "origin", remoteUrl]);
  } else if (remoteCheck.output !== remoteUrl) {
    runCommand("git", ["remote", "set-url", "origin", remoteUrl]);
  }

  runCommand("git", ["push", "-u", "origin", "main"]);
  runCommand("git", ["push", "-u", "origin", "issue/1-bootstrap-modelcanon"]);
  runCommand("git", ["push", "origin", "refs/notes/lognexus"]);

  const issuesRes = tryCommand("gh", [
    "issue",
    "list",
    "--repo",
    REPO_SLUG,
    "--state",
    "all",
    "--json",
    "number,title",
  ]);
  const issues = issuesRes.ok ? JSON.parse(issuesRes.output) : [];
  if (issues.length === 0) {
    runCommand("gh", [
      "issue",
      "create",
      "--repo",
      REPO_SLUG,
      "--title",
      "Bootstrap @digital-lake/modelcanon v0.1.0 standalone MCP server",
      "--body",
      "Tracks the initial 0.1.0 implementation, tests, seed snapshot, and multi-registry distribution manifests.",
    ]);
  }

  const prsRes = tryCommand("gh", [
    "pr",
    "list",
    "--repo",
    REPO_SLUG,
    "--head",
    "issue/1-bootstrap-modelcanon",
    "--json",
    "number,url",
  ]);
  const prs = prsRes.ok ? JSON.parse(prsRes.output) : [];
  if (prs.length === 0) {
    const prBody = runCommand("npx", ["lognexus", "timeline", "main", "--pr-body"], {
      capture: true,
    });
    runCommand("gh", [
      "pr",
      "create",
      "--repo",
      REPO_SLUG,
      "--base",
      "main",
      "--head",
      "issue/1-bootstrap-modelcanon",
      "--title",
      `feat(#1): bootstrap @digital-lake/modelcanon v${meta.version}`,
      "--body",
      prBody ?? "Bootstrap ModelCanon v0.1.0.",
    ]);
  }

  process.stdout.write("[OK] GitHub repository, environment, notes, and PR ready.\n");
}

function runNpmInitial() {
  const whoami = tryCommand("npm", ["whoami"]);
  if (!whoami.ok) {
    throw new Error("npm CLI is not authenticated. Run 'npm login' first.");
  }
  runCommand("npm", ["publish", "--access", "public"]);
  process.stdout.write(
    "[OK] Initial npm publish complete. Link OIDC Trusted Publisher on npmjs.com.\n",
  );
}

function runPypiInitial() {
  if (!process.env.UV_PUBLISH_TOKEN?.trim()) {
    throw new Error(
      "UV_PUBLISH_TOKEN is not set. Export UV_PUBLISH_TOKEN or use PyPI Pending Publisher OIDC in release.yml.",
    );
  }
  runCommand("uv", ["build", "--out-dir", "dist-pypi"]);
  const files = readdirSync(resolve(ROOT_DIR, "dist-pypi")).map((f) =>
    resolve(ROOT_DIR, "dist-pypi", f),
  );
  runCommand("uv", ["publish", ...files]);
  process.stdout.write("[OK] Initial PyPI upload complete.\n");
}

function runMergeRelease() {
  runCommand("gh", [
    "pr",
    "merge",
    "issue/1-bootstrap-modelcanon",
    "--repo",
    REPO_SLUG,
    "--merge",
    "--delete-branch",
  ]);
  process.stdout.write("[OK] PR merged to main; release.yml workflow triggered.\n");
}

function runMcpRegistryPublish() {
  const bin = resolveMcpPublisherBin();
  if (!bin) {
    throw new Error("mcp-publisher binary not found. Set MCP_PUBLISHER_BIN or install on PATH.");
  }
  runCommand(bin, ["publish"]);
}

function printUsage() {
  process.stdout.write(
    [
      "ModelCanon Release Orchestrator",
      "",
      "Usage:",
      "  node scripts/publish-release.mjs --preflight         Verify builds, tarballs, wheels, and auth",
      "  node scripts/publish-release.mjs --github-bootstrap  Create repo, push main/branch/notes, open PR",
      "  node scripts/publish-release.mjs --npm-initial       Run initial public npm publish (requires npm login)",
      "  node scripts/publish-release.mjs --pypi-initial      Upload dist-pypi/* via uv publish (requires UV_PUBLISH_TOKEN)",
      "  node scripts/publish-release.mjs --merge-release     Merge PR to main to trigger OIDC release.yml",
      "  node scripts/publish-release.mjs --mcp-registry      Publish server.json via local mcp-publisher",
      "",
    ].join("\n"),
  );
}

const flag = process.argv[2];
switch (flag) {
  case "--preflight":
    runPreflight();
    break;
  case "--github-bootstrap":
    runGithubBootstrap();
    break;
  case "--npm-initial":
    runNpmInitial();
    break;
  case "--pypi-initial":
    runPypiInitial();
    break;
  case "--merge-release":
    runMergeRelease();
    break;
  case "--mcp-registry":
    runMcpRegistryPublish();
    break;
  default:
    printUsage();
    process.exitCode = flag ? 1 : 0;
}
