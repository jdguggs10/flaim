# Documentation Index

This file is the canonical map for Flaim docs. Always read this first and use it to decide where updates belong. Avoid duplicating facts across multiple docs.

## Source-of-truth map (update these first)

| Fact type | Source of truth | Notes |
|---|---|---|
| Tools list + descriptions | `docs/STATUS.md` | If a tool is added/changed, update here first. |
| Platform/sport feature parity | `docs/STATUS.md` | Keep parity tables here; link elsewhere. |
| Deploy targets + envs | `docs/STATUS.md` | Keep in sync with `.github/workflows/deploy-workers.yml` and worker wranglers. |
| Database schema summary | `docs/DATABASE.md` | Migrations in `docs/migrations/` are canonical. |
| Test strategy | `docs/TESTING.md` | Keep light; focus on critical paths. |
| Public product overview | `README.md` | User-facing, high level. |
| Architecture overview | `docs/ARCHITECTURE.md` | System design + data flow. |
| Release history | `docs/CHANGELOG.md` | Keep a concise, high-level record. |
| Backlog | `docs/dev/TODO.md` | Active list of bugs/features/maintenance. |
| Design/implementation plans | `docs/plans/*` | Short-lived design notes. |
| Historical reports | `docs/archive/*` | Read-only; do not update. |

## Doc map (what each doc is for)

### Permanent docs (long-lived)
- `README.md`: Public overview, how it works, key features, basic setup.
- `AGENTS.md`: Agent behavior rules and repo guardrails for automated tooling.
- `CLAUDE.md`: Claude-specific guidance (treat as repo tooling notes).
- `GEMINI.md`: Gemini-specific guidance (treat as repo tooling notes).
- `docs/ARCHITECTURE.md`: System architecture, runtime choices, data flow, deployment notes.
- `docs/STATUS.md`: Canonical tools list, parity matrix, deploy targets.
- `docs/DATABASE.md`: Schema summary; refer to `docs/migrations/` for truth.
- `docs/TESTING.md`: Testing guidance and commands.
- `docs/STYLE-GUIDE.md`: Design tokens, component guidelines, accessibility standards, and frontend code conventions.
- `docs/CHANGELOG.md`: Release history (keep it concise).

### Dev docs (temporal / work-in-progress)
- `docs/dev/`: Active plans, in-progress feature notes, and short-lived checklists. These are expected to change frequently.
- `docs/dev/TODO.md`: Active backlog items. When an item becomes permanent knowledge, move it to a permanent doc.

### Component READMEs
- `web/README.md`: Web app routes, env vars, local dev.
- `extension/README.md`: Extension build, sync host, Chrome Web Store details.
- `workers/README.md`: Worker overview, envs, shared patterns.

### Per-worker READMEs
- `workers/auth-worker/README.md`: Auth/OAuth, credentials, extension APIs.
- `workers/fantasy-mcp/README.md`: Unified MCP gateway, tools, routing.
- `workers/espn-client/README.md`: ESPN platform client details.
- `workers/yahoo-client/README.md`: Yahoo platform client details.

### Internal/reference markdown
- `workers/espn-client/src/sports/baseball/MAPPINGS.md`: ESPN baseball slot/position mapping notes.
- `workers/espn-client/src/sports/football/MAPPINGS.md`: ESPN football slot/position mapping notes.

## After feature work checklist (LLM + human)

1. Did you add/change a tool or handler? Update `docs/STATUS.md`.
2. Did you change platform coverage or parity? Update `docs/STATUS.md`.
3. Did you change data storage or schema? Update `docs/DATABASE.md` (and migrations).
4. Did you change deploy targets or envs? Update `docs/STATUS.md` (and verify CI).
5. Did you change user-facing behavior? Update `README.md`.
6. Did you change system design or flows? Update `docs/ARCHITECTURE.md`.
7. Did you add/remove a worker or major component? Update `workers/README.md` and the relevant per-worker README.
8. Did you change frontend components or design tokens? Verify compliance with `docs/STYLE-GUIDE.md` and run `npm run ui:check`.

## Rule: no duplication

If a fact already lives in a source-of-truth doc, link to it instead of copying tables or lists.
