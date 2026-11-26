# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-11-26

### Changed
- **Glama & SLSA Provenance Verification:** Added official Glama MCP Directory (`score.svg` & `card.svg`), Sigstore SLSA OIDC Provenance, Socket Security, and TDQS Grade A badges and audit matrix to `README.md`.
- **GitHub Actions Modernization (`@v7` / `@v4`):** Upgraded `actions/checkout@v7`, `actions/setup-node@v7`, `actions/setup-python@v7`, `github/codeql-action@v4`, and `sigstore/cosign-installer@v4.1.3` across `ci.yml`, `codeql.yml`, and `release.yml`, superseding Dependabot PRs `#6`–`#9` and adding automatic npm CDN propagation retries for `mcp-publisher`.
- **Container OCI Version Metadata:** Added `org.opencontainers.image.version` to `Dockerfile` and triggered Glama `Auto-Release` synchronization at `0.1.2`.

## [0.1.1] - 2026-11-26

### Changed
- **AI-SEO Hero & Multi-Platform Documentation:** Upgraded `README.md` and `llms.txt` with a descriptive AI-SEO header, centered hero block, per-OS MCP client configuration and native cache paths (`Linux`, `macOS`, `Windows`), and ecosystem distribution matrix.
- **Multi-Platform & Provenance Metadata Parity:** Standardized explicit OS classifiers (`Operating System :: MacOS`, `Microsoft :: Windows`, `POSIX :: Linux`), keywords, and lead author/copyright attribution (`HorchataHTML` & `Digital Lake`) across `package.json`, `pyproject.toml`, `server.json`, `Dockerfile`, `LICENSE`, and `NOTICE.md`.
- **Trusted Publisher SLSA Provenance:** First automated GitHub OIDC Trusted Publisher release (`--provenance`) across npm, PyPI, and the Official MCP Registry, extending `scripts/sync-version.mjs` to guard `MCP_SERVER_VERSION` and HTTP `User-Agent` headers.

## [0.1.0] - 2026-11-26

### Added
- Initial pre-release of `@digital-lake/modelcanon` (`modelcanon-mcp` PyPI wrapper).
- Official `@modelcontextprotocol/sdk` `stdio` MCP server exposing `audit_model_id`, `get_latest_updates`, and `list_active_models` with `outputSchema`, `structuredContent`, and read-only `annotations`.
- Deterministic adapters for Google Gemini, Anthropic Claude, OpenAI, DeepSeek, and Moonshot AI (Kimi) backed by `models.dev`, LiteLLM, and optional native `GET /models` checks.
- Cross-platform atomic JSON cache (`darwin`, `linux`, `win32`) with in-memory fallback and live-verified `data/seed.json` snapshot.
- `Dockerfile`, `glama.json`, `server.json`, `smithery.yaml`, 3-OS CI, CodeQL, Dependabot, and OIDC release workflow.
