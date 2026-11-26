# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2026-11-26

### Fixed
- **Linear First-Party LiteLLM RSS Allowlist & Classification (`T2`, `T3`):** Replaced blacklist-only RSS filtering with a linear `O(n)` first-party platform map (`Google AI Studio`, `Google`, `Gemini`, `Anthropic`, `OpenAI`, `DeepSeek`, `Moonshot`, `Kimi`), discarding reseller/subscription noise (`GMI Cloud`, `Replicate`, `NVIDIA NIM`, `ChatGPT Subscription`, `Vertex AI`) and parameter-tweak items, extracting `effective_date` from deprecation items, and cross-checking `evt_litellm_*` `models_affected` against the merged catalog alongside a regression guard asserting zero outbound `If-None-Match` headers.
- **Biome Diagnostic Hygiene (`T1`):** Added `minIsoDate()` string comparator and resolved all 4 Biome lint warnings across provider adapters without unsafe auto-fixes.

### Changed
- **Generational & Base-Model Ranking (`T4`):** Added `src/domain/rank.ts` (`parseModelShape`, `compareModelsForListing`) to strip trailing date/build suffixes in linear time, prioritize conversational base models ahead of vertical/experimental variants (`-healthcare`, `-law`, `-preview`, `-highspeed`) and dated snapshots, rank higher numeric generations and flagship tiers first (`claude-opus-5-5` > `claude-sonnet-5-5` > `claude-haiku-5-5`), and tie-break ascending (`A -> Z`).
- **Live Seed Integrity & 12-Surface Version Parity (`T5`, `T6`):** Enforced LiteLLM RSS catalog invariants in `scripts/build-seed.mjs`, regenerated `data/seed.json`, and extended `scripts/sync-version.mjs` to synchronize `llms.txt` and `.github/ISSUE_TEMPLATE/bug-report.yml` (preserving zero changes to `src/mcp/tools.ts`).

## [0.1.3] - 2026-11-26

### Fixed
- **Catalog ID Hygiene & Official Kimi Tables (`H1`, `B2`, `B3`):** Filtered `.md`/documentation slugs and non-conversational enricher keys (`ft:*`, `"search"`, `"container"`), added `https://platform.kimi.ai/docs/models.md` GFM table ingestion, removed noisy `llms.txt` pseudo-events, and scoped K3 1M-token constraints strictly to `kimi-k3*` models.
- **Lifecycle Authority & Unified Effective Status (`H2`, `B1`, `B4`, `B5`):** Introduced `"explicit" | "mention"` patch authority so prose mentions never overwrite `catalog_only` deprecation metadata or official URLs, detected DeepSeek discontinuation notices (`deepseek-chat` / `deepseek-reasoner` retired `2026-07-24`), and unified `resolveEffectiveStatus()` across `audit_model_id`, `list_active_models`, and `modelcanon://deprecations/upcoming`.
- **Event Chronology & Third-Party Proxy Filtering (`H3`, `B8`):** Clamped `published_at` dates (`<= today`), preserved future shutdown horizons in `effective_date`, excluded third-party reseller items (`Azure`, `Bedrock`, `Vertex`, `Baseten`, `Together`, `AIHubMix`) from LiteLLM RSS events, and enforced upper UTC bounds on `days` queries.
- **SWR Cache Deduplication & Versioned Envelopes (`H4`, `B6`, `B7`):** Added `inFlightRefresh` deduplication, 5-minute failure cooldown, `cli` vs `server` refresh modes, `.unref()` timer safety, and `CACHE_PACKAGE_VERSION` invalidation on upgrades.

### Changed
- **Agnostic Harness Normalization & Round-Robin Catalog Ranking (`H5`, `H8`):** Supported `gemini/`/`claude/`/`kimi/`/`xai/` prefixes, trailing `(client)` tags, and verified effort suffixes (`-high`/`-medium`/`-low`), prioritized flagship conversational models, and interleaved `provider: "all"` results round-robin.
- **Seed Integrity Guards & Documentation Parity (`B9`, `H9`):** Extended `scripts/build-seed.mjs` (`--check`) to assert catalog and event integrity, aligned Windows `%LOCALAPPDATA%\modelcanon\cache` casing in `README.md`, and extended `scripts/sync-version.mjs` across all 10 version surfaces.

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
