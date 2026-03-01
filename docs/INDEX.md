# Documentation Index

This file is the canonical map for Flaim docs. Update this when document ownership changes.

## Source-of-Truth Map

| Fact type | Source of truth | Notes |
|---|---|---|
| Active tasks + execution state | Linear (Flaim team) | Source of truth for all actionable work. |
| Tool list + platform/sport support | `README.md`, `docs/CONNECTOR-DOCS.md` | Keep user-facing capabilities aligned with code and MCP schema. |
| Deploy targets + runtime topology | `docs/ARCHITECTURE.md` | Keep infra/runtime details aligned with active deployments. |
| Database schema summary | `docs/DATABASE.md` | Migrations in `docs/migrations/` remain canonical. |
| Error code taxonomy (private reference) | `workers/shared/src/errors.ts` | Canonical source in code; reviewer-facing doc in private workspace. |
| Testing strategy | `docs/TESTING.md` | Keep lightweight and practical. |
| Eval harness operations/runbooks | `../flaim-eval/docs/*` | Canonical in separate repo. |
| Local Codex eval helper skill | `~/.codex/skills/flaim-eval-ops/SKILL.md` | Optional local-only helper for running eval flow; policy remains in `../flaim-eval/docs/*`. |
| Public product overview | `README.md` | User-facing high-level overview. |
| Architecture overview | `docs/ARCHITECTURE.md` | System design and data flow. |
| Release history | `docs/CHANGELOG.md` | Condensed historical release notes. |
| iOS app research (Foundation Models + MCP) | `docs/dev/2026-02-22-ios-app-research.md` | Technical feasibility, repo options, timeline, strategy. |
| Transactions API research (ESPN, Yahoo, Sleeper) | `docs/dev/2026-02-23-transactions-api-research.md` | Endpoint details, response shapes, caveats, and implementation notes for a `get_transactions` MCP tool. |
| Distribution strategy + submission packets (private) | Private workspace | Strategy, submission packets, runbooks, tool versioning. Not in this repo. |
| Connector user docs | `docs/CONNECTOR-DOCS.md` | Single user-facing setup + examples (for directory reviewers too). |
| Historical docs/plans pointers | `docs/plans/README.md`, `../flaim-archive/2026-02-08-repo-doc-cleanup/README.md`, `../flaim-archive/2026-03-01-search-players-rollout/README.md` | External archive source-of-truth for stale docs. |

## Permanent Docs (Long-Lived)

- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/TESTING.md`
- `docs/STYLE-GUIDE.md`
- `docs/CHANGELOG.md`
- `docs/CONNECTOR-DOCS.md`
- `docs/STATUS.md` (deprecated stub — points to canonical sources)
- `docs/plans/README.md`

## Dev Docs (Research Archive)

Static dated research and analysis artifacts. Not updated in place — new investigations get new files.

- `docs/dev/2026-02-22-ios-app-research.md`
- `docs/dev/2026-02-23-transactions-api-research.md`
- `docs/dev/2026-02-20-fantrax-integration-research.md`
- `docs/dev/2026-02-20-platform-integration-sleeper-audit.md`

Historical analyses/plans were externalized:
- `docs/plans/README.md`
- `../flaim-archive/2026-02-08-repo-doc-cleanup/README.md`
- `../flaim-archive/2026-03-01-search-players-rollout/README.md`

## External Repo Docs

- `../flaim-eval/README.md`
- `../flaim-eval/docs/INDEX.md`

## Component READMEs

- `web/README.md`
- `extension/README.md`
- `workers/README.md`
- `workers/auth-worker/README.md`
- `workers/fantasy-mcp/README.md`
- `workers/espn-client/README.md`
- `workers/yahoo-client/README.md`
- `workers/sleeper-client/README.md`

## Maintenance Rules

1. Update `README.md`, `docs/CONNECTOR-DOCS.md`, and/or `docs/ARCHITECTURE.md` when tool coverage, endpoints, deploy targets, or channel readiness changes.
2. Track all tasks and execution state in Linear (Flaim team). Do not create task lists in docs.
3. Move superseded plans/reports to the external archive bundle, then update `docs/plans/README.md` and relevant archive README in `../flaim-archive/*`.
4. Prefer links to canonical docs instead of duplicating tables across files.
5. Keep distribution strategy and submission-operational docs in the private workspace, not in this repo.
