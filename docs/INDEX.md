# Documentation Index

This file is the canonical map for Flaim docs. Update this when document ownership changes.

## Source-of-Truth Map

| Fact type | Source of truth | Notes |
|---|---|---|
| Current delivery phase + what is next | `docs/dev/CURRENT-EXECUTION-STATE.md` | Canonical execution tracker. |
| Tools list + platform/sport support + deploy targets | `docs/STATUS.md` | Keep aligned with code and CI. |
| Database schema summary | `docs/DATABASE.md` | Migrations in `docs/migrations/` remain canonical. |
| Error code taxonomy | `docs/ERROR-CODES.md` | Codes defined in `workers/shared/src/errors.ts`. |
| Testing strategy | `docs/TESTING.md` | Keep lightweight and practical. |
| Eval harness operations/runbooks | `../flaim-eval/docs/*` | Canonical in separate repo. |
| Public product overview | `README.md` | User-facing high-level overview. |
| Architecture overview | `docs/ARCHITECTURE.md` | System design and data flow. |
| Release history | `docs/CHANGELOG.md` | Condensed historical release notes. |
| Backlog | `docs/dev/TODO.md` | Active backlog only. |
| Directory submission packets | `docs/submissions/*` | Re-verify before submission. |
| Tool versioning policy | `docs/TOOL-VERSIONING.md` | Breaking vs non-breaking guidance. |
| Connector user docs | `docs/CONNECTOR-DOCS.md` | Single user-facing setup + examples (for directory reviewers too). |
| Historical docs/plans pointers | `docs/archive/README.md`, `docs/plans/README.md` | External archive source-of-truth for stale docs. |

## Permanent Docs (Long-Lived)

- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `docs/ARCHITECTURE.md`
- `docs/STATUS.md`
- `docs/DATABASE.md`
- `docs/TESTING.md`
- `docs/STYLE-GUIDE.md`
- `docs/ERROR-CODES.md`
- `docs/CHANGELOG.md`
- `docs/CONNECTOR-DOCS.md`
- `docs/MANUAL-OAUTH-RUNBOOKS.md`
- `docs/TOOL-VERSIONING.md`
- `docs/archive/README.md`
- `docs/plans/README.md`
- `docs/submissions/anthropic-connector-submission.md`
- `docs/submissions/openai-app-submission.md`

## Dev Docs (Working Set)

- `docs/dev/CURRENT-EXECUTION-STATE.md` (primary execution tracker)
- `docs/dev/TODO.md`

Historical analyses/plans were externalized:
- `docs/archive/README.md`
- `docs/plans/README.md`

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

1. Update `docs/STATUS.md` when tool coverage, endpoints, deploy targets, or channel readiness changes.
2. Update `docs/dev/CURRENT-EXECUTION-STATE.md` when sprint/phase status changes.
3. Move superseded plans/reports to the external archive bundle, then update `docs/archive/README.md` and/or `docs/plans/README.md`.
4. Prefer links to canonical docs instead of duplicating tables across files.
