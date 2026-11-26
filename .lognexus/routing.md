# Model-Tier Routing Configuration

# Modes: confirm (pause and prompt) | warn (banner only) | off (silent)
routing: confirm

# Orchestration: auto (native swarm/subagent) | swarm | subagent | off
orchestration: auto

# Review Gate: auto | cross-vendor | intra-fleet | advisory | off
review_gate: intra-fleet
implementer: auto
reviewer: auto

# Tip: Cross-family review is recommended for critical milestones, while intra-fleet review (e.g. Fable/Opus -> Sonnet, GPT-6.2 Astra -> Sol/Luna in ChatGPT/Codex, Argon/Carbon/Neon -> Hydrogen/Flash) works out of the box for single-provider teams. Cross-vendor review is never forced: review_gate: auto uses intra-fleet, and single-session ChatGPT/solo workflows may set review_gate: advisory or off.

# Operational Tier Taxonomy (Empirical recommendations across Gemini, Claude, OpenAI, DeepSeek, Kimi — Nov 2026)
# tier-1 (Reasoning / Arch / Review Gate): Gemini 4 Carbon, Gemini 4 Argon, Gemini 4 Neon, Claude Fable 5.2 / Mythos 5.2 / Opus 5.5, OpenAI GPT-6.2 Astra / o3, DeepSeek R1
# tier-2 (Orchestration / Large Context >500 lines): Gemini 4 Hydrogen, Gemini 3.8 Flash High, Claude Sonnet 5.5, OpenAI GPT-6.2 Sol / GPT-5.4 / Codex, Kimi K3 / K2.7 Code
# tier-3 (Scoped Execution / Focused Modules <500 lines): Gemini Flash, DeepSeek V3 (Chat), Kimi Code, Claude Haiku 5.5, OpenAI GPT-6 Luna / codex-mini / GPT-4o-mini

# Native Assistant Autonomy & Contract Execution Governance
# max_subtask_files: 6
# max_subtask_loc: 1200
# assistant_autonomy: Operate freely with native IDE/assistant capabilities during conversation, analysis, and exploration
# contract_governance: When executing an active subtask contract (.lognexus/state.json), strictly obey allowedFiles, forbiddenFiles, decisionBudget, and verificationCmd
