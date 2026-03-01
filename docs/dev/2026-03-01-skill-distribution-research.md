# Skill Distribution Research

**Date:** 2026-03-01
**Status:** Fact-checked; implementation tracked separately
**Tracking:** FLA-38 (separate from completed FLA-22)

## Context

Flaim has a skill prompt file (`flaim-eval/instructions/fantasy-analyst-v2.md`) that teaches LLMs how to act as fantasy analysts across ESPN/Yahoo/Sleeper workflows. The content is useful, but it is currently not distributed in a standard cross-platform skill location.

## Independent Verification Summary

### Confirmed (primary sources)

- Agent Skills is an open standard announced by Anthropic on **2025-12-18**.
- The standard skill shape is a directory with required `SKILL.md` and optional `scripts/`, `references/`, `assets/`.
- Skill activation is metadata-first: platforms inspect `name` and `description`, then load full instructions only when relevant.
- MCP prompts are user-facing templates, not silent system injection. Spec language is: clients **SHOULD NOT** auto-invoke prompts without user interaction.

### Corrected / Clarified

- `.agents/skills/` should be treated as a **cross-platform convention**, not a guaranteed single discovery path for every tool.
- Platform-native paths still matter (`.claude/skills`, `.gemini/skills`, etc.) and should be documented per platform.
- Adoption count in ecosystem docs changes over time. Use dated wording (for example: "as of 2026-03-01") instead of fixed marketing numbers.

### Unverified or weakly sourced claims (removed from recommendations)

- ChatGPT internal codename claims (e.g., "Hazelnut").
- Definitive third-party submission process claims for vendor directories when no official public process is documented.

## Practical Recommendation

1. Publish canonical skill in public repo at `.agents/skills/flaim-fantasy/SKILL.md`.
2. Keep installation docs conservative:
   - Mention `.agents/skills` as the shared convention.
   - Include platform-native fallback locations where officially documented.
3. Treat MCP prompts as optional starter UX, not a replacement for skill behavior instructions.

## Current Skill Conformance (High-Level)

The existing file appears structurally close to the standard but should be migrated to:

- directory name: `flaim-fantasy/`
- filename: `SKILL.md`
- frontmatter: clear `name` + `description` trigger language

Notes:
- Token/line budgets should be treated as guidance unless a platform enforces hard limits.
- Additional metadata fields can be added when there is clear platform value.

## Source Quality Notes

- Prioritize official spec and product documentation.
- Use blogs/news posts only as secondary confirmation, not as authoritative behavior/spec references.

## Sources (Primary First)

- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Skills spec repository](https://github.com/agent-skills/spec)
- [Agent Skills schema](https://raw.githubusercontent.com/agent-skills/spec/main/SKILL.schema.json)
- [Anthropic announcement (2025-12-18)](https://www.anthropic.com/news/claude-code-sdk-skills)
- [OpenAI Codex Skills docs](https://developers.openai.com/codex/skills)
- [MCP prompts specification](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts)

## Implementation (2026-03-01)

**Completed:**
- `.agents/skills/flaim-fantasy/SKILL.md` — canonical skill published in public repo
- `agent-browser` skill removed from flaim repo, relocated to root workspace (`/Users/ggugger/Code/.agents/skills/`)
- README updated with skill-first framing and install instructions

**Deferred:**
- `flaim.app/skill` download page — tracked separately when prioritized
- Claude/OpenAI/Gemini directory submissions — tracked when official submission processes open
- MCP prompts (`registerPrompt()`) — low priority; only adds value as a conversation starter UX
