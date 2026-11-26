# Open Source Notice

## Lead Author & Core Architecture

Copyright (c) 2026 [HorchataHTML](https://github.com/HorchataHTML)  
Copyright (c) 2026 [Digital Lake](https://github.com/digital-lake-ai) and ModelCanon contributors.

**ModelCanon** is designed, engineered, and maintained by **[HorchataHTML](https://github.com/HorchataHTML)** and **[Digital Lake](https://github.com/digital-lake-ai)** under the [MIT License](https://github.com/digital-lake-ai/modelcanon/blob/main/LICENSE), including:

- **Core Runtime & CLI:** Deterministic TypeScript/ESM ingestion engine, multi-provider changelog and deprecation parsers, atomic cross-platform JSON cache (`Linux`, `macOS`, and `Windows`) with offline `seed.json` fallback, and CLI (`@digital-lake/modelcanon` on npm / `modelcanon-mcp` on PyPI).
- **Native MCP Server:** Read-only annotated Model Context Protocol stdio server (`io.github.digital-lake-ai/modelcanon`) exposing `audit_model_id`, `get_latest_updates`, `list_active_models`, and live catalog resources.

---

## Public Catalog & Documentation Sources

ModelCanon aggregates publicly accessible technical metadata from:
- **models.dev** (`https://models.dev/api.json`) — open-source AI model metadata catalog.
- **LiteLLM** (`https://github.com/BerriAI/litellm`) — open-source model pricing, context window, and RSS changelog datasets.
- **Official Provider Documentation** — Google Gemini (`ai.google.dev`), Anthropic Claude (`platform.claude.com`), OpenAI (`developers.openai.com`), DeepSeek (`api-docs.deepseek.com`), and Moonshot AI / Kimi (`platform.kimi.ai`, `platform.moonshot.ai`).

All third-party trademarks and model names remain the property of their respective owners.
