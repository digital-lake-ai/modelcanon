# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-26

### Added
- Initial pre-release of `@digital-lake/modelcanon` (`modelcanon-mcp` PyPI wrapper).
- Official `@modelcontextprotocol/sdk` `stdio` MCP server exposing `audit_model_id`, `get_latest_updates`, and `list_active_models` with `outputSchema`, `structuredContent`, and read-only `annotations`.
- Deterministic adapters for Google Gemini, Anthropic Claude, OpenAI, DeepSeek, and Moonshot AI (Kimi) backed by `models.dev`, LiteLLM, and optional native `GET /models` checks.
- Cross-platform atomic JSON cache (`darwin`, `linux`, `win32`) with in-memory fallback and live-verified `data/seed.json` snapshot.
- `Dockerfile`, `glama.json`, `server.json`, `smithery.yaml`, 3-OS CI, CodeQL, Dependabot, and OIDC release workflow.
