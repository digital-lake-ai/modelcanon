# Security Policy

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `0.2.x` | Yes |
| `0.1.x` | Security fixes |

## Reporting a Vulnerability

Please report security vulnerabilities privately via [GitHub Security Advisories](https://github.com/digital-lake-ai/modelcanon/security/advisories/new). This is the only supported reporting channel. Do not open public issues for unpatched vulnerabilities.

### What to Include
1. A clear description of the vulnerability and potential impact.
2. Minimal reproduction steps (MCP tool payload, CLI invocation, or fixture).
3. Your runtime details (Node.js version, Python `uvx` version if applicable, OS, and ModelCanon version).

### Response Timeline
- **Initial Acknowledgment:** Within 48 hours of submission.
- **Triage & Remediation:** Assessment and targeted release timeline within 5 business days.
- **Coordinated Disclosure:** We credit reporters in release advisories unless anonymity is requested.

## Runtime Security & Capability Boundaries

ModelCanon is designed as a deterministic, read-only MCP server with strict isolation boundaries:
- **HTTPS-Only Transport:** Outbound HTTP ingestion enforces `https:` URLs, caps response size (`maxBytes`), limits redirects (`<= 3`), rejects `https` to `http` downgrades, and strips `Authorization`, `x-api-key`, and `x-goog-api-key` headers on cross-origin redirects.
- **Zero Shell Execution:** Runtime code never spawns a shell (`shell: false` in Node.js and `shell=False` in Python `uvx` wrappers).
- **Read-Only Tool Contracts:** All three MCP tools declare `readOnlyHint: true`, `destructiveHint: false`, and `idempotentHint: true`.
- **No Secret Persistence:** Optional provider API keys (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`, `XAI_API_KEY`) are used strictly in memory via headers (`x-goog-api-key` for Gemini, never query parameters) and are never written to disk or logs.
- **Offline & Read-Only Resilience:** Falls back automatically to in-memory caching and the bundled `data/seed.json` snapshot when disk writes or network calls fail.

## Supply-Chain Posture & Dependency Disposition

We audit supply-chain alerts rigorously (`0` known CVEs/GHSAs via `npm audit`, `0` license conflicts; see [#24](https://github.com/digital-lake-ai/modelcanon/issues/24)):

| Package | Scope | Shipped in Runtime Package? | Assessment & Boundary |
| :--- | :--- | :--- | :--- |
| `@modelcontextprotocol/sdk`, `zod` | Direct `dependencies` (Production) | **Yes** | Required for official MCP SDK protocol compliance and Zod `outputSchema` validation. Remains under active security monitoring. |
| `es-module-lexer` | Transitive `devDependencies` (via `vitest`) | **No** (`--omit=dev`, excluded from `package.json#files`) | Compiled WebAssembly ESM parser used exclusively during local/CI test runs (`0` CVEs/GHSAs). |
| `@tybys/wasm-util` | Optional peer `devDependencies` (via `@napi-rs/wasm-runtime`) | **No** (not shipped in runtime distributions) | Uninstalled/optional dev-only WASI utility; never installed or executed by production MCP users. |
