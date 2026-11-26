# Contributing to ModelCanon

Thank you for contributing to **ModelCanon** (`@digital-lake/modelcanon`).

## Development Principles
- **English Only:** All source code, comments, commit messages, tests, and documentation must be written strictly in English.
- **Deterministic Runtime:** ModelCanon never calls an LLM at runtime. All parsers extract verbatim quotes, structured tables, and official URLs.
- **Strict Security Hygiene:** Enforce `https:`-only upstream fetches, linear `O(n)` sanitization (no polynomial ReDoS), and `shell: false` / `shell=False` across all scripts and wrappers.
- **Zero Regressions in MCP Schemas:** Preserve `readOnlyHint: true`, `outputSchema`, `structuredContent`, and clear `Use when ... Not for ...` tool descriptions.

## Local Setup & Verification

```bash
npm ci
npm run version:check
npm run lint
npm run build
npm run seed:check
npm test
```

## Versioning & Release Parity

ModelCanon follows [Semantic Versioning](https://semver.org/). Keep all six version surfaces synchronized using:

```bash
npm run version:check
npm run version:sync <X.Y.Z>
```

Synchronized surfaces:
1. `package.json` (`version`)
2. `package-lock.json` (`version` and `packages[""].version`)
3. `server.json` (`version` and `packages[*].version`)
4. `pyproject.toml` (`[project] version`)
5. `python/modelcanon_mcp/__init__.py` (`__version__`)
6. `src/cli.ts` (`getCliVersion()`)

## Pull Request Guidelines
- Open an issue or reference an existing issue before starting feature work.
- Use issue-scoped branches (`issue/<id>-<slug>`) cut from `main`.
- Merge approved PRs using standard merge commits (`--no-ff`) so subtask history and traceability remain intact.
- Report security issues privately as described in [SECURITY.md](./SECURITY.md).
