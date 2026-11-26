import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), "utf8")) as Record<string, unknown>;
}

describe("Multiplatform packaging, version parity, and registry manifests", () => {
  it("aligns server.json, package.json, glama.json, smithery.yaml, and Dockerfile at 0.1.4", () => {
    const pkg = readJson("package.json");
    const server = readJson("server.json");
    const glama = readJson("glama.json");
    const smithery = readFileSync(resolve(ROOT, "smithery.yaml"), "utf8");

    expect(pkg.name).toBe("@digital-lake/modelcanon");
    expect(pkg.version).toBe("0.1.4");
    expect(pkg.mcpName).toBe("io.github.digital-lake-ai/modelcanon");
    expect(pkg.os).toEqual(["darwin", "linux", "win32"]);
    expect(pkg.keywords).toEqual(
      expect.arrayContaining(["linux", "macos", "windows", "cross-platform"]),
    );
    expect(JSON.stringify(pkg.author)).toContain("Digital Lake");
    expect(JSON.stringify(pkg.contributors)).toContain("HorchataHTML");
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(glama.$schema).toBe("https://glama.ai/mcp/schemas/server.json");
    expect(glama.maintainers).toEqual(["digital-lake-ai", "HorchataHTML"]);
    expect(smithery).toContain("@digital-lake/modelcanon");
    expect(existsSync(resolve(ROOT, "Dockerfile"))).toBe(true);
  });

  it("provides a safe cross-platform Python uvx wrapper", () => {
    const pyproject = readFileSync(resolve(ROOT, "pyproject.toml"), "utf8");
    const pyInit = readFileSync(resolve(ROOT, "python/modelcanon_mcp/__init__.py"), "utf8");
    const pyMain = readFileSync(resolve(ROOT, "python/modelcanon_mcp/__main__.py"), "utf8");

    expect(pyproject).toContain('name = "modelcanon-mcp"');
    expect(pyproject).toContain('version = "0.1.4"');
    expect(pyproject).toContain('"Operating System :: MacOS"');
    expect(pyproject).toContain('"Operating System :: Microsoft :: Windows"');
    expect(pyproject).toContain('"Operating System :: POSIX :: Linux"');
    expect(pyproject).toContain("HorchataHTML");
    expect(pyproject).toContain("Digital Lake");
    expect(pyInit).toContain('__version__ = "0.1.4"');
    expect(pyInit).toContain('"npx.cmd"');
    expect(pyInit).toContain("shell=False");
    expect(pyMain).toContain("main_mcp()");
  });

  it("includes MCP registry ownership comment, Glama badge, docs, and passes version:check", () => {
    const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
    const license = readFileSync(resolve(ROOT, "LICENSE"), "utf8");
    const notice = readFileSync(resolve(ROOT, "NOTICE.md"), "utf8");
    expect(readme.startsWith("<!-- mcp-name: io.github.digital-lake-ai/modelcanon -->")).toBe(true);
    expect(readme).toContain("https://glama.ai/mcp/servers/digital-lake-ai/modelcanon");
    expect(readme).toContain("**Linux**, **macOS**, and **Windows**");
    expect(readme).toContain("Copyright (c) 2026 HorchataHTML (https://github.com/HorchataHTML)");
    expect(readme).toContain(
      "Copyright (c) 2026 Digital Lake (https://github.com/digital-lake-ai) and ModelCanon contributors.",
    );
    expect(license).toContain("Copyright (c) 2026 HorchataHTML (https://github.com/HorchataHTML)");
    expect(license).toContain(
      "Copyright (c) 2026 Digital Lake (https://github.com/digital-lake-ai) and ModelCanon contributors",
    );
    expect(notice).toContain("HorchataHTML");
    expect(notice).toContain("Digital Lake");
    expect(existsSync(resolve(ROOT, "llms.txt"))).toBe(true);
    expect(existsSync(resolve(ROOT, "CHANGELOG.md"))).toBe(true);
    expect(existsSync(resolve(ROOT, "SECURITY.md"))).toBe(true);

    const out = execFileSync(
      process.execPath,
      [resolve(ROOT, "scripts/sync-version.mjs"), "--check"],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    expect(out).toContain("0.1.4");

    const releaseYml = readFileSync(resolve(ROOT, ".github/workflows/release.yml"), "utf8");
    expect(existsSync(resolve(ROOT, "scripts/publish-release.mjs"))).toBe(true);
    expect(releaseYml).toContain("actions/checkout@v7");
    expect(releaseYml).toContain("npm install -g npm@latest");
    expect(releaseYml).toContain('npm view "@digital-lake/modelcanon@$' + '{VERSION}"');
    expect(releaseYml).toContain('echo "new_version=$' + '{new_version}" >> "$' + 'GITHUB_OUTPUT"');
    expect(releaseYml).toContain("mcp-publisher login github-oidc");
    expect(String(readJson("server.json").description).length).toBeLessThanOrEqual(100);
  });

  it("enforces strict English-only tracked files, zero docs/contexto history, and Triple-A security hygiene", () => {
    for (const requiredFile of [
      "SECURITY.md",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "NOTICE.md",
      ".github/ISSUE_TEMPLATE/bug-report.yml",
      ".github/ISSUE_TEMPLATE/model-discrepancy.yml",
    ]) {
      expect(existsSync(resolve(ROOT, requiredFile))).toBe(true);
    }

    const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);

    expect(tracked.some((f) => f.startsWith("docs/contexto/"))).toBe(false);

    const spanishChars =
      /[\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\u00bf\u00a1]/;
    const forbiddenEmail = `${"@"}digital-lake.ai`;
    for (const relPath of tracked) {
      if (relPath === "package-lock.json" || relPath === "data/seed.json") continue;
      const content = readFileSync(resolve(ROOT, relPath), "utf8");
      expect(spanishChars.test(content), `Spanish character found in ${relPath}`).toBe(false);
      expect(content, `Placeholder email found in ${relPath}`).not.toContain(forbiddenEmail);
    }

    for (const wf of [
      ".github/workflows/ci.yml",
      ".github/workflows/codeql.yml",
      ".github/workflows/release.yml",
    ]) {
      const yml = readFileSync(resolve(ROOT, wf), "utf8");
      expect(yml, `${wf} must declare permissions`).toContain("permissions:");
    }

    for (const relPath of tracked.filter(
      (f) => f.startsWith("src/") || f.startsWith("scripts/") || f.startsWith("python/"),
    )) {
      const code = readFileSync(resolve(ROOT, relPath), "utf8");
      expect(code, `Unsafe shell: true in ${relPath}`).not.toContain("shell: true");
      expect(code, `Unsafe cmd.exe in ${relPath}`).not.toContain("cmd.exe");
    }
  });
});
