import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), "utf8")) as Record<string, unknown>;
}

describe("Multiplatform packaging, version parity, and registry manifests", () => {
  it("aligns server.json, package.json, glama.json, smithery.yaml, and Dockerfile at 0.1.0", () => {
    const pkg = readJson("package.json");
    const server = readJson("server.json");
    const glama = readJson("glama.json");
    const smithery = readFileSync(resolve(ROOT, "smithery.yaml"), "utf8");

    expect(pkg.name).toBe("@digital-lake/modelcanon");
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.mcpName).toBe("io.github.digital-lake-ai/modelcanon");
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(glama.$schema).toBe("https://glama.ai/mcp/schemas/server.json");
    expect(smithery).toContain("@digital-lake/modelcanon");
    expect(existsSync(resolve(ROOT, "Dockerfile"))).toBe(true);
  });

  it("provides a safe cross-platform Python uvx wrapper", () => {
    const pyproject = readFileSync(resolve(ROOT, "pyproject.toml"), "utf8");
    const pyInit = readFileSync(resolve(ROOT, "python/modelcanon_mcp/__init__.py"), "utf8");
    const pyMain = readFileSync(resolve(ROOT, "python/modelcanon_mcp/__main__.py"), "utf8");

    expect(pyproject).toContain('name = "modelcanon-mcp"');
    expect(pyproject).toContain('version = "0.1.0"');
    expect(pyInit).toContain('__version__ = "0.1.0"');
    expect(pyInit).toContain('"npx.cmd"');
    expect(pyInit).toContain("shell=False");
    expect(pyMain).toContain("main_mcp()");
  });

  it("includes MCP registry ownership comment, docs, and passes version:check", () => {
    const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
    expect(readme.startsWith("<!-- mcp-name: io.github.digital-lake-ai/modelcanon -->")).toBe(true);
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
    expect(out).toContain("0.1.0");

    const releaseYml = readFileSync(resolve(ROOT, ".github/workflows/release.yml"), "utf8");
    expect(existsSync(resolve(ROOT, "scripts/publish-release.mjs"))).toBe(true);
    expect(releaseYml).toContain('npm view "@digital-lake/modelcanon@${VERSION}"');
    expect(releaseYml).toContain("mcp-publisher login github-oidc");
    expect(String(readJson("server.json").description).length).toBeLessThanOrEqual(100);
  });
});
