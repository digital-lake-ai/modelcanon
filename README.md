<!-- mcp-name: io.github.digital-lake-ai/modelcanon -->

# ModelCanon — Official AI Model Changelog, Deprecation & API Spec MCP Server

<p align="center">
  <strong>Deterministic AI Model Lifecycle, Deprecation &amp; Live API Specification Engine for Coding Agents</strong><br>
  Available on npm as <code>@digital-lake/modelcanon</code> and PyPI as <code>modelcanon-mcp</code> across <strong>Linux</strong>, <strong>macOS</strong>, and <strong>Windows</strong>.<br>
  Explore the 3 annotated read-only MCP tools &amp; 2 catalog resources in <a href="https://github.com/digital-lake-ai/modelcanon/blob/main/llms.txt">llms.txt</a> and <a href="https://github.com/digital-lake-ai/modelcanon/blob/main/server.json">server.json</a>.
</p>

<div align="center">

[![CI](https://github.com/digital-lake-ai/modelcanon/actions/workflows/ci.yml/badge.svg)](https://github.com/digital-lake-ai/modelcanon/actions/workflows/ci.yml)
[![CodeQL](https://github.com/digital-lake-ai/modelcanon/actions/workflows/codeql.yml/badge.svg)](https://github.com/digital-lake-ai/modelcanon/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/@digital-lake/modelcanon?color=0969da&logo=npm&label=npm)](https://www.npmjs.com/package/@digital-lake/modelcanon)
[![npm downloads](https://img.shields.io/npm/dm/@digital-lake/modelcanon?color=cb3837&logo=npm&label=npm%20downloads)](https://www.npmjs.com/package/@digital-lake/modelcanon)
[![PyPI version](https://img.shields.io/pypi/v/modelcanon-mcp?color=3775a9&logo=pypi&logoColor=white&label=pypi)](https://pypi.org/project/modelcanon-mcp/)
[![PyPI downloads](https://img.shields.io/pypi/dw/modelcanon-mcp?color=3775a9&logo=pypi&logoColor=white&label=pypi%20downloads)](https://pypi.org/project/modelcanon-mcp/)
[![ModelCanon MCP server – quality and maintenance score on Glama](https://glama.ai/mcp/servers/digital-lake-ai/modelcanon/badges/score.svg)](https://glama.ai/mcp/servers/digital-lake-ai/modelcanon)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-active-0d9488)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.digital-lake-ai/modelcanon)
[![Organization](https://img.shields.io/badge/org-Digital_Lake-7c3aed)](https://github.com/digital-lake-ai)

[![SLSA Provenance](https://img.shields.io/badge/SLSA_Provenance-Verified_OIDC-2ea44f?logo=sigstore&logoColor=white)](https://www.npmjs.com/package/@digital-lake/modelcanon)
[![Socket Security](https://img.shields.io/badge/Socket_Audit-0_CVEs-2ea44f?logo=socketdotdev&logoColor=white)](https://socket.dev/npm/package/@digital-lake/modelcanon)
[![MCP TDQS](https://img.shields.io/badge/MCP_TDQS-Grade_A-0d9488)](https://glama.ai/mcp/servers/digital-lake-ai/modelcanon)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178c6?logo=typescript&logoColor=white)](https://github.com/digital-lake-ai/modelcanon)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20_LTS-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-%3E%3D3.10_(uvx)-3775a9?logo=python&logoColor=white)](https://pypi.org/project/modelcanon-mcp/)
[![Platforms](https://img.shields.io/badge/Platforms-Linux_%7C_macOS_%7C_Windows-0284c7)](#installation--cross-platform-setup)
[![Offline Seed](https://img.shields.io/badge/Offline_Seed-%3C15ms_Fallback-2ea44f)](#what-is-modelcanon)
[![License: MIT](https://img.shields.io/badge/license-MIT-0284c7)](https://github.com/digital-lake-ai/modelcanon/blob/main/LICENSE)

</div>

---

## What is ModelCanon?

AI coding agents and automated pipelines routinely fail due to **model lifecycle drift**: LLM training cutoffs cause agents to hardcode deprecated or retired model IDs, miss official replacement slugs, or pass rejected parameters (such as `temperature` on reasoning-only models).

**ModelCanon provides a deterministic, citation-backed source of truth via the Model Context Protocol (MCP).** It ingests official machine-readable provider documentation without invoking any LLM at runtime:
- **Clients:** Claude Code, Claude Desktop, Cursor, Codex, GitHub Copilot, Google Antigravity, Kimi Code, VS Code, Windsurf, Zed.
- **Providers Tracked:** Google Gemini (`gemini`), Anthropic Claude (`claude`), OpenAI (`openai`), DeepSeek (`deepseek`), Moonshot AI / Kimi (`kimi`), xAI Grok (`xai`), Z.ai GLM (`zai`), and Alibaba Qwen (`qwen`).
- **Supported Platforms:** **Linux**, **macOS**, and **Windows** (`linux`, `darwin`, `win32` — 100% cross-platform Node.js `>= 20` & Python `>= 3.10` `uvx`, zero native binary dependencies, verified continuously across Ubuntu, macOS, and Windows CI runners).

Every query is cited with primary official URLs and falls back instantaneously (`< 15 ms`) to a bundled offline seed snapshot (`data/seed.json`) when running inside air-gapped, sandboxed, or read-only environments.

---

## Coverage Matrix (Primary Official Sources)

| Provider | ID | Primary Machine-Readable Sources | Optional Live Catalog (`env`) |
| :--- | :--- | :--- | :--- |
| **Google Gemini** | `gemini` | `deprecations.md.txt`, `changelog.md.txt`, `llms.txt` | `GEMINI_API_KEY` (`GET /v1beta/models`) |
| **Anthropic Claude** | `claude` | `model-deprecations.md`, `release-notes/overview.md`, `llms.txt` | `ANTHROPIC_API_KEY` (`GET /v1/models`) |
| **OpenAI** | `openai` | `deprecations.md`, `changelog.md`, `news/rss.xml` | `OPENAI_API_KEY` (`GET /v1/models`) |
| **DeepSeek** | `deepseek` | `api-docs.deepseek.com/updates` | `DEEPSEEK_API_KEY` (`GET /models`) |
| **Moonshot AI (Kimi)** | `kimi` | `platform.kimi.ai/docs/models.md`, `llms.txt`, `pricing/chat.md` | `MOONSHOT_API_KEY` (`GET /v1/models`) |
| **xAI Grok** | `xai` | `docs.x.ai/developers/models.md`, `release-notes.md` | `XAI_API_KEY` (`GET /v1/models`) |
| **Z.ai GLM** | `zai` | `docs.z.ai/guides/overview/pricing.md`, `release-notes.md` | `models.dev` / `LiteLLM` |
| **Alibaba Qwen** | `qwen` | `model-studio/models.md`, `newly-released-models.md`, `api-compatibility-upgrade-notice.md` | `models.dev` / `DashScope` (`qwen*` / `qwq*`) |

Specs, context windows, output limits, and per-1M token pricing are deterministically enriched via `models.dev/api.json` (`GET`-only) and LiteLLM's open catalog and changelog RSS. No LLMs are invoked at runtime.

---

## Installation & Cross-Platform Setup

ModelCanon runs natively on **Linux**, **macOS**, and **Windows** via `npx` (`@digital-lake/modelcanon`) or Python `uvx` (`modelcanon-mcp`).

**MCP Client Configuration Paths:**
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json` or `~/.claude.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json` or `~/.claude.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json` or `~/.claude.json`
- **Google Antigravity:** `~/.gemini/config/mcp_config.json` or `.agents/mcp_config.json`
- **Cursor / VS Code:** `~/.cursor/mcp.json`, `.cursor/mcp.json`, or `.vscode/mcp.json`

### Option 1: Node.js (`npx`) — Linux, macOS, Windows

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

### Option 2: Python (`uvx` / `pip` from PyPI) — Linux, macOS, Windows

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

Or launch/install directly from the terminal:
```bash
uvx modelcanon-mcp
pip install modelcanon-mcp
```

### Option 3: Smithery CLI

```bash
npx -y @smithery/cli install @digital-lake/modelcanon --client claude
```

**Cross-Platform Native Cache Paths** (with automatic in-memory fallback on read-only filesystems):
- **Linux:** `$XDG_CACHE_HOME/modelcanon` (defaults to `~/.cache/modelcanon`)
- **macOS:** `~/Library/Caches/modelcanon`
- **Windows:** `%LOCALAPPDATA%\modelcanon\cache`

---

## MCP Tools, Resources & Example Output

### Annotated Read-Only Tools (`outputSchema` + `structuredContent`)
1. **`audit_model_id(model_id)`**: Checks `active | deprecated | retired | unknown`, UTC days remaining until shutdown, official replacement ID, context/output limits, parameter constraints, and primary citation URL (`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`).
2. **`get_latest_updates(provider?, days?, category?, limit?)`**: Returns compact extractive changelog and deprecation entries (`< 150` tokens/item) with `source_url` and `confidence`.
3. **`list_active_models(provider?, include_deprecated?, limit?)`**: Lists active model IDs with context windows, max output tokens, and pricing per 1M tokens.

### Live MCP Resources
- `modelcanon://catalog/summary` — Snapshot metadata, provider coverage, and cache freshness.
- `modelcanon://deprecations/upcoming` — Models currently deprecated or scheduled for shutdown.

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

**How can my coding agent check if a Gemini, Claude, or OpenAI model ID is deprecated?**
Install ModelCanon in your MCP client (`npx -y @digital-lake/modelcanon` or `uvx modelcanon-mcp`) and invoke `audit_model_id` with any dated or undated model ID (e.g., `claude-sonnet-4-5`, `gemini-2.5-pro`, `gpt-4.1`).

**Does ModelCanon require provider API keys?**
No. All eight official provider adapters, `models.dev`, and LiteLLM operate without API keys. Setting `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`, or `XAI_API_KEY` only enables optional live `GET /models` cross-checks.

**What happens if a model ID is unknown?**
ModelCanon returns `status: "unknown"` rather than guessing `"active"`.

**Does it work on Windows, macOS, Linux, and read-only Docker containers?**
Yes. Every commit is tested on `ubuntu-latest`, `macos-latest`, and `windows-latest`, ships a verified `data/seed.json` snapshot, and falls back automatically to in-memory cache when disk writes are blocked.

---

## Verified Quality & Ecosystem Distribution

<div align="center">

[![ModelCanon MCP server – quality and maintenance score on Glama](https://glama.ai/mcp/servers/digital-lake-ai/modelcanon/badges/card.svg)](https://glama.ai/mcp/servers/digital-lake-ai/modelcanon)

</div>

| Surface / Auditor | Identifier / Scope | Verified Status & Platform Coverage |
| :--- | :--- | :--- |
| **Glama MCP Directory** | [`digital-lake-ai/modelcanon`](https://glama.ai/mcp/servers/digital-lake-ai/modelcanon) | **Official** · License `A` · Quality `A` · Server Coherence `A` · TDQS `Grade A` (**Linux**, **macOS**, **Windows**) |
| **SLSA Provenance** | Sigstore & GitHub Actions OIDC (`--provenance`) | **Verified** (`slsa.dev/provenance/v1`, 2 public maintainers) |
| **Socket Security** | Supply-chain & vulnerability audit | **0 CVEs** · Zero shell execution (`shell: false`) |
| **npm Registry** | [`@digital-lake/modelcanon`](https://www.npmjs.com/package/@digital-lake/modelcanon) (`npx`) | **Linux**, **macOS**, **Windows** (`linux`, `darwin`, `win32`) |
| **PyPI Registry** | [`modelcanon-mcp`](https://pypi.org/project/modelcanon-mcp/) (`uvx` / `pip`, OIDC attested) | **Linux**, **macOS**, **Windows** (`shell=False`) |
| **Official MCP Registry** | `io.github.digital-lake-ai/modelcanon` (`server.json`) | **Active** (`github-oidc` + Sigstore `cosign`) |
| **CI Matrix & CodeQL** | GitHub Actions (`ci.yml`, `codeql.yml`, `dependabot.yml`) | `ubuntu-latest`, `macos-latest`, `windows-latest` (`@v7` / `@v4`) |
| **Container Runtime** | Non-root multi-stage `Dockerfile` (`node:22-alpine`) | OCI Linux containers (`USER node`, offline fallback enabled) |

## Security & Supply-Chain Guarantees

- **HTTPS-Only Ingestion:** Rejects non-HTTPS URLs, blocks `https` to `http` downgrade redirects, limits response sizes (`maxBytes`), and strips sensitive headers across cross-origin redirects.
- **Zero Shell Execution:** Subprocesses and `uvx` wrappers execute strictly with `shell: false` / `shell=False` (`npx.cmd` resolved safely on Windows via `shutil.which`).
- **Read-Only MCP Contracts:** All tools declare `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `outputSchema`, and `structuredContent`.
- **No Secret Persistence:** Optional provider API keys remain strictly in memory (`x-goog-api-key` header for Gemini, never query strings).
- **Automated Supply-Chain Controls:** Published with npm OIDC Provenance, PyPI Trusted Publishing, Official MCP Registry OIDC, CodeQL (`javascript-typescript` & `python`), Socket Security, and Dependabot.

---

## Provenance & Maintainers

**ModelCanon** is designed, engineered, and maintained by **[HorchataHTML](https://github.com/HorchataHTML)** and **[Digital Lake](https://github.com/digital-lake-ai)**.

---

## License

ModelCanon is released under the [MIT License](https://github.com/digital-lake-ai/modelcanon/blob/main/LICENSE) and [NOTICE.md](https://github.com/digital-lake-ai/modelcanon/blob/main/NOTICE.md).  
Copyright (c) 2026 HorchataHTML (https://github.com/HorchataHTML)  
Copyright (c) 2026 Digital Lake (https://github.com/digital-lake-ai) and ModelCanon contributors.
