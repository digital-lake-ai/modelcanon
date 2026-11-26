<!-- mcp-name: io.github.digital-lake-ai/modelcanon -->

# ModelCanon (`@digital-lake/modelcanon`)

[![CI](https://github.com/digital-lake-ai/modelcanon/actions/workflows/ci.yml/badge.svg)](https://github.com/digital-lake-ai/modelcanon/actions/workflows/ci.yml)
[![CodeQL](https://github.com/digital-lake-ai/modelcanon/actions/workflows/codeql.yml/badge.svg)](https://github.com/digital-lake-ai/modelcanon/actions/workflows/codeql.yml)
[![Organization](https://img.shields.io/badge/org-Digital_Lake-7c3aed)](https://github.com/digital-lake-ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178c6?logo=typescript&logoColor=white)](https://github.com/digital-lake-ai/modelcanon)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20_LTS-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Platforms](https://img.shields.io/badge/Platforms-Linux_%7C_macOS_%7C_Windows-0284c7)](#zero-friction-installation)
[![License: MIT](https://img.shields.io/badge/license-MIT-0284c7)](./LICENSE)

**Deterministic MCP server for official AI model changelogs, deprecation tracking, and live API specifications across Google Gemini, Anthropic Claude, OpenAI, DeepSeek, and Moonshot Kimi.**

ModelCanon prevents coding agents and CI workflows from hardcoding retired model IDs, hitting unexpected shutdown redirects, or using unsupported API parameters (such as `temperature` on models that reject it) due to LLM training cutoffs. Every response is deterministic, cited with primary official URLs, and falls back instantly (`< 15 ms`) to a bundled offline seed snapshot when running in sandboxed or air-gapped environments.

---

## Coverage Matrix (Primary Official Sources)

| Provider | ID | Primary Machine-Readable Sources | Optional Live Catalog (`env`) |
| :--- | :--- | :--- | :--- |
| **Google Gemini** | `gemini` | `deprecations.md.txt`, `changelog.md.txt`, `llms.txt` | `GEMINI_API_KEY` (`GET /v1beta/models`) |
| **Anthropic Claude** | `claude` | `model-deprecations.md`, `release-notes/overview.md`, `llms.txt` | `ANTHROPIC_API_KEY` (`GET /v1/models`) |
| **OpenAI** | `openai` | `deprecations.md`, `changelog.md`, `news/rss.xml` | `OPENAI_API_KEY` (`GET /v1/models`) |
| **DeepSeek** | `deepseek` | `api-docs.deepseek.com/updates` | `DEEPSEEK_API_KEY` (`GET /models`) |
| **Moonshot AI (Kimi)** | `kimi` | `platform.kimi.ai/docs/llms.txt`, `pricing/chat.md` | `MOONSHOT_API_KEY` (`GET /v1/models`) |

Specs, context windows, output limits, and per-1M token pricing are deterministically enriched via `models.dev/api.json` (`GET`-only) and LiteLLM's open catalog and changelog RSS. No LLMs are invoked at runtime.

---

## Zero-Friction Installation

### Option 1: Node.js (`npx`) — Cursor, VS Code, Claude Desktop, Antigravity

```json
{
  "mcpServers": {
    "modelcanon": {
      "command": "npx",
      "args": ["-y", "@digital-lake/modelcanon"]
    }
  }
}
```

### Option 2: Python (`uvx`)

```json
{
  "mcpServers": {
    "modelcanon": {
      "command": "uvx",
      "args": ["modelcanon-mcp"]
    }
  }
}
```

---

## MCP Tools & Example Output

1. **`audit_model_id(model_id)`**: Checks `active | deprecated | retired | unknown`, days remaining until shutdown, official replacement ID, context/output limits, parameter constraints, and citation URL.
2. **`get_latest_updates(provider?, days?, category?, limit?)`**: Returns compact extractive changelog and deprecation entries (`< 150` tokens/item).
3. **`list_active_models(provider?, include_deprecated?, limit?)`**: Lists active model IDs with context windows, max output tokens, and pricing per 1M tokens.

Example `audit_model_id({ "model_id": "claude-sonnet-4-5" })`:

```json
{
  "queried_id": "claude-sonnet-4-5",
  "canonical_id": "claude-sonnet-4-5-20250929",
  "provider": "claude",
  "status": "deprecated",
  "days_until_shutdown": 4,
  "deprecation_date": "2026-09-30",
  "shutdown_date": "2026-11-30",
  "replacement_id": "claude-sonnet-5-5",
  "context_window": 200000,
  "max_output_tokens": 64000,
  "supports_temperature": true,
  "api_constraints": [],
  "official_url": "https://platform.claude.com/docs/en/about-claude/model-deprecations.md",
  "source_origin": "bundled_seed",
  "stale": true,
  "last_verified_at": "2026-11-26T08:00:00.000Z"
}
```

---

## CLI Usage

```bash
npx @digital-lake/modelcanon                       # Start stdio MCP server
npx @digital-lake/modelcanon audit gpt-4.1 --json  # Audit a single model ID
npx @digital-lake/modelcanon sync --json           # Refresh local JSON cache
```

---

## Frequently Asked Questions

**How can my coding agent check if a Gemini or Claude model ID is deprecated?**
Install ModelCanon in your MCP client and invoke `audit_model_id` with any dated or undated model ID (e.g., `claude-sonnet-4-5`, `gemini-2.5-pro`, `gpt-4.1`).

**Does ModelCanon require provider API keys?**
No. All five adapters, `models.dev`, and LiteLLM operate without API keys. Setting `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, or `MOONSHOT_API_KEY` only enables optional live `GET /models` cross-checks.

**What happens if a model ID is unknown?**
ModelCanon returns `status: "unknown"` rather than guessing `"active"`.

**Does it work offline or inside read-only containers?**
Yes. Every release ships a verified `data/seed.json` snapshot and falls back automatically to in-memory cache when disk writes are blocked.

---

## First-Release Distribution Checklist (`v0.1.0`)

1. Run `npm publish --access public` manually with 2FA to claim `@digital-lake/modelcanon` on npm.
2. Link `.github/workflows/release.yml` as an npm OIDC Trusted Publisher within 48 hours.
3. Configure PyPI Pending Publisher for `modelcanon-mcp` pointing to `digital-lake-ai/modelcanon` (`release.yml`, environment `Digital-Lake-ModelCanon`).
4. Run `mcp-publisher login github && mcp-publisher publish` for `server.json` (`io.github.digital-lake-ai/modelcanon`).
5. Claim the repository on Glama (`glama.json` + `Dockerfile`) and Smithery (`smithery.yaml`).

## Security & Supply-Chain Guarantees

- **HTTPS-Only Ingestion:** Rejects non-HTTPS URLs, blocks `https` to `http` downgrade redirects, limits response sizes (`maxBytes`), and strips sensitive headers across cross-origin redirects.
- **Zero Shell Execution:** Subprocesses and `uvx` wrappers execute strictly with `shell: false` / `shell=False`.
- **Read-Only MCP Contracts:** All tools declare `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `outputSchema`, and `structuredContent`.
- **No Secret Persistence:** Optional provider API keys remain strictly in memory (`x-goog-api-key` header for Gemini, never query strings).
- **Automated Supply-Chain Controls:** Published with npm SLSA Provenance (OIDC), PyPI Trusted Publishing, CodeQL (`javascript-typescript` & `python`), and Dependabot.

## License

MIT — see [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md).
