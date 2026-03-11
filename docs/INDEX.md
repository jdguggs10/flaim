# Documentation Index

Canonical map for docs that live inside this repository.

## Source-of-Truth Map

| Fact type | Source of truth | Notes |
|---|---|---|
| Product/tool overview | `README.md`, `docs/CONNECTOR-DOCS.md` | User-facing capabilities and setup.
| Runtime topology | `docs/ARCHITECTURE.md` | Deploy and service interaction model.
| Data model summary | `docs/DATABASE.md` | Schema overview; migrations in `docs/migrations/`.
| Testing approach | `docs/TESTING.md` | Practical test scope and commands.
| Release history | `docs/CHANGELOG.md` | Condensed release notes.
| Worker behavior | `workers/*/README.md` | Service-specific implementation notes.
| Frontend conventions | `docs/STYLE-GUIDE.md` | Lightweight in-repo style baseline.

## Permanent Docs

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/TESTING.md`
- `docs/STYLE-GUIDE.md`
- `docs/CHANGELOG.md`
- `docs/CONNECTOR-DOCS.md`

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

1. Keep docs inside this repo internally consistent and cross-linked by repo-relative paths.
2. Avoid duplicating large tables/facts when a canonical in-repo doc already exists.
3. Implementation plans and migration runbooks are maintained outside this repo; do not add them to this index.
4. Keep execution checklists out of repo docs.
