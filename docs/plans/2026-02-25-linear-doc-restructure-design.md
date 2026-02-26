# Design: Linear-First Doc Restructure

**Date:** 2026-02-25
**Status:** Approved
**Scope:** `flaim`, `flaim-eval`, `flaim-marketing`, `flaim-submissions`

## Problem

With Linear now established as the source of truth for task tracking, several doc files still operate as standalone task lists and execution trackers. This creates duplication, drift, and maintenance burden for a solo dev.

## Principles

- **Docs = context and reference only.** No tasks, no next actions, no unchecked checkboxes.
- **Linear = everything actionable.** Full stop.
- **`docs/dev/` = static dated research artifacts only.** Not a working set of living docs.
- **History = CHANGELOG.** Completion logs belong there, not in execution trackers.
- **Lean by default.** Solo hobby project — every doc must earn its place.

## Taxonomy

| Category | Location | Content |
|----------|----------|---------|
| Orientation | `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` | Architecture, conventions, commands, AI instructions |
| System facts | `docs/STATUS.md` | Endpoints, tools, platform support, channel readiness |
| History | `docs/CHANGELOG.md` | What shipped and when |
| Reference | Static files (`docs/`, `flaim-submissions/`, `flaim-eval/docs/`) | Architecture, runbooks, submission packets, research |
| Tasks | Linear only | Everything actionable |

## Changes

### Delete

| File | Reason |
|------|--------|
| `flaim/docs/dev/TODO.md` | Fully replaced by Linear |
| `flaim/docs/dev/CURRENT-EXECUTION-STATE.md` | Tasks in Linear; history already in CHANGELOG |
| `flaim-submissions/internal-docs/TRANSACTIONS-DELTA-CHECKLIST.md` | Replaced by Linear issue FLA-5 |

### Update

**`flaim/docs/CHANGELOG.md`**
- Absorb any completion history from CURRENT-EXECUTION-STATE.md not already present (minimal — most items already in CHANGELOG).

**`flaim/docs/INDEX.md`**
- Remove `TODO.md` and `CURRENT-EXECUTION-STATE.md` from the source-of-truth map.
- Update `docs/dev/` description: static dated research/analysis artifacts only.
- Remove "Backlog" row from source-of-truth table.
- Update maintenance rules: remove references to updating CURRENT-EXECUTION-STATE.md; add note that tasks go to Linear.

**`flaim/docs/STATUS.md`**
- Remove "Current Delivery Phase" section (task tracking).
- Remove specific eval run timestamps (stale; eval harness was overhauled).
- Keep all pure system facts: endpoints, tools, platform support, channel readiness, CI targets, extension version.

**`flaim/CLAUDE.md`**
- Update Documentation Routing: remove "temporal, in-progress docs live in `docs/dev/`".
- Replace with: "`docs/dev/` contains static dated research/analysis docs only."
- Simplify Linear-First protocol: remove "reference FLA-* next to doc items" bullet. New rule: docs contain no tasks — if you find one, move it to Linear and remove it from the doc.

**`flaim/AGENTS.md`**
- Same Documentation Routing update as CLAUDE.md.
- Same Linear-First protocol simplification.

**`flaim/GEMINI.md`**
- Same Documentation Routing update as CLAUDE.md.
- Same Linear-First protocol simplification.

**`flaim-eval/docs/INDEX.md`**
- Remove reference to `../flaim/docs/dev/CURRENT-EXECUTION-STATE.md` as "cross-repo execution tracker".
- Replace with: "Active tasks tracked in Linear (Flaim team)."

**`flaim-marketing/README.md`**
- Strip "In progress" task items from "What I'm Doing Right Now" section.
- Keep the section for context but remove any actionable items (those live in Linear as FLA-21, FLA-22, FLA-23).

### Leave Unchanged

- `flaim/docs/ARCHITECTURE.md`, `DATABASE.md`, `TESTING.md`, `CONNECTOR-DOCS.md`, `STYLE-GUIDE.md`
- `flaim/docs/dev/` dated research docs (2026-02-*.md) — static artifacts, correct as-is
- `flaim-submissions/` packets and remaining internal docs — private reference, no tasks
- `flaim-marketing/strategy/` — strategic context, no tasks
- `flaim-eval/docs/OPERATIONS.md`, `ACCEPTANCE.md`, `OBSERVABILITY.md`, `TROUBLESHOOTING.md` — operational reference; owner should update these after eval harness overhaul is stable

## What Does NOT Change

The Linear-First protocol text in CLAUDE.md/AGENTS.md/GEMINI.md is sound. Only the "reference FLA-* in docs" bullet is removed — that was a transitional rule for a hybrid state that no longer exists.

## Success Criteria

- No unchecked task lists in any doc file across all four repos.
- `docs/dev/` contains only dated, immutable research files.
- `docs/INDEX.md` accurately reflects the new structure.
- All three agent instruction files give consistent, correct routing guidance.
- A new AI session reading `CLAUDE.md` + `docs/INDEX.md` goes directly to Linear for tasks, not to TODO.md.
