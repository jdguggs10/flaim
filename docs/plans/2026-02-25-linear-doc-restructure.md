# Linear-First Doc Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate all task-tracking content from docs across four repos, leaving docs as pure context/reference with Linear as the sole home for actionable work.

**Architecture:** Delete three files that exist only for task tracking, strip task/execution sections from remaining docs, and update all agent instruction files (CLAUDE.md, AGENTS.md, GEMINI.md) to give consistent routing guidance. No new files created.

**Tech Stack:** Markdown only. No code changes.

---

### Task 1: Verify CHANGELOG.md has the missing history

Before deleting CURRENT-EXECUTION-STATE.md, confirm its "Completed Recently" entries are already captured in CHANGELOG.md so nothing is lost.

**Files:**
- Read: `flaim/docs/dev/CURRENT-EXECUTION-STATE.md` (Completed Recently section)
- Read: `flaim/docs/CHANGELOG.md` ([Unreleased] section)

**Step 1: Check for missing entries**

Scan CURRENT-EXECUTION-STATE.md "Completed Recently" items:
- Transactions tool rollout (2026-02-23) → should be in CHANGELOG under `get_transactions`
- Sleeper Phase 2 (2026-02-24) → should be in CHANGELOG under "Sleeper Phase 2"
- Submission readiness recheck (2026-02-19) → eval run data, does NOT belong in CHANGELOG (stale)
- Terms of Service page (2026-02-20) → check if present
- OpenAI submission prep (2026-02-16) → check if present

**Step 2: Add any missing entries to CHANGELOG.md**

If any shipped-feature entries are absent, add them under `## [Unreleased]`. Skip eval run timestamps entirely — those are operational noise, not changelog entries.

**Step 3: Commit if CHANGELOG was changed**

```bash
cd /Users/ggugger/Code/flaim
git add docs/CHANGELOG.md
git commit -m "docs: absorb missing history from CURRENT-EXECUTION-STATE into CHANGELOG"
```

Skip commit if no changes needed.

---

### Task 2: Delete the three task-tracking files

**Files:**
- Delete: `flaim/docs/dev/TODO.md`
- Delete: `flaim/docs/dev/CURRENT-EXECUTION-STATE.md`
- Delete: `flaim-submissions/internal-docs/TRANSACTIONS-DELTA-CHECKLIST.md`

**Step 1: Delete the files**

```bash
rm /Users/ggugger/Code/flaim/docs/dev/TODO.md
rm /Users/ggugger/Code/flaim/docs/dev/CURRENT-EXECUTION-STATE.md
rm /Users/ggugger/Code/flaim-submissions/internal-docs/TRANSACTIONS-DELTA-CHECKLIST.md
```

**Step 2: Verify deletion**

```bash
ls /Users/ggugger/Code/flaim/docs/dev/
ls /Users/ggugger/Code/flaim-submissions/internal-docs/
```

Expected: neither `TODO.md` nor `CURRENT-EXECUTION-STATE.md` appear; `TRANSACTIONS-DELTA-CHECKLIST.md` gone.

**Step 3: Commit**

```bash
cd /Users/ggugger/Code/flaim
git add -A
git commit -m "docs: delete TODO.md and CURRENT-EXECUTION-STATE.md (replaced by Linear)"

cd /Users/ggugger/Code/flaim-submissions
git add -A
git commit -m "docs: delete TRANSACTIONS-DELTA-CHECKLIST.md (replaced by Linear FLA-5)"
```

---

### Task 3: Update docs/INDEX.md

Remove the two deleted files from the source-of-truth map and update the `docs/dev/` framing.

**Files:**
- Modify: `flaim/docs/INDEX.md`

**Step 1: Remove the Backlog row from the source-of-truth table**

Find and remove this row:
```
| Backlog | `docs/dev/TODO.md` | Active backlog only. |
```

**Step 2: Remove CURRENT-EXECUTION-STATE.md from source-of-truth table**

Find and remove this row:
```
| Current delivery phase + what is next | `docs/dev/CURRENT-EXECUTION-STATE.md` | Canonical execution tracker. |
```

Replace with:
```
| Active tasks + execution state | Linear (Flaim team) | Source of truth for all actionable work. |
```

**Step 3: Update the Dev Docs (Working Set) section**

Replace:
```markdown
## Dev Docs (Working Set)

- `docs/dev/CURRENT-EXECUTION-STATE.md` (primary execution tracker)
- `docs/dev/TODO.md`
```

With:
```markdown
## Dev Docs (Research Archive)

Static dated research and analysis artifacts. Not updated in place — new investigations get new files.

- `docs/dev/2026-02-22-ios-app-research.md`
- `docs/dev/2026-02-23-transactions-api-research.md`
- `docs/dev/2026-02-20-fantrax-integration-research.md`
- `docs/dev/2026-02-20-platform-integration-sleeper-audit.md`
```

**Step 4: Update Maintenance Rules**

Remove rule 2:
```
2. Update `docs/dev/CURRENT-EXECUTION-STATE.md` when sprint/phase status changes.
```

Replace with:
```
2. Track all tasks and execution state in Linear (Flaim team). Do not create task lists in docs.
```

**Step 5: Commit**

```bash
cd /Users/ggugger/Code/flaim
git add docs/INDEX.md
git commit -m "docs: update INDEX.md to reflect Linear as task source of truth"
```

---

### Task 4: Update docs/STATUS.md

Strip the two task-tracking sections; keep all pure system facts.

**Files:**
- Modify: `flaim/docs/STATUS.md`

**Step 1: Remove "Current Delivery Phase" section entirely**

Find and delete:
```markdown
## Current Delivery Phase

- Active phase: basketball/hockey and Sleeper integration shipped; submission and verification ongoing.
- Canonical execution tracker: `docs/dev/CURRENT-EXECUTION-STATE.md`.
```

**Step 2: Remove stale eval run data from "Eval Observability" section**

Find and remove these two lines:
```
- Latest full eval run (`2026-02-24T00-56-48Z`) completed `17/17`, `0` errored.
- Latest acceptance + presubmit for that run are `PASS`.
```

Leave the rest of the Eval Observability section intact (headers, eval tags, artifact layout, tooling).

**Step 3: Commit**

```bash
cd /Users/ggugger/Code/flaim
git add docs/STATUS.md
git commit -m "docs: strip task-tracking sections and stale eval data from STATUS.md"
```

---

### Task 5: Update CLAUDE.md

Two targeted changes: fix `docs/dev/` framing, simplify Linear-First protocol.

**Files:**
- Modify: `flaim/CLAUDE.md`

**Step 1: Fix Documentation Routing line**

Find:
```
- Permanent docs live in `docs/`; temporal, in-progress docs live in `docs/dev/`.
```

Replace with:
```
- Permanent docs live in `docs/`. `docs/dev/` contains static dated research/analysis artifacts only — not a working set of living docs.
```

**Step 2: Simplify Linear-First protocol**

Find and remove this bullet (and its two sub-bullets):
```
- When you find an actionable item in docs (`TODO`, `NEXT`, unchecked checklist item, follow-up, or pending), do one of:
  - Link it to an existing Linear issue.
  - Create a new Linear issue immediately.
- Reference the Linear issue ID next to the doc item (example: `Linear: FLA-123`).
```

Replace with:
```
- Docs contain no tasks. If you find an actionable item in a doc (`TODO`, `NEXT`, unchecked checklist item, follow-up, or pending), move it to Linear and remove it from the doc.
```

Also update:
```
- Do not leave durable unchecked task lists in docs without a corresponding Linear issue.
```
to:
```
- Do not leave tasks or unchecked checklists in docs. Docs are context and reference only.
```

**Step 3: Commit**

```bash
cd /Users/ggugger/Code/flaim
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md doc routing and simplify Linear-First protocol"
```

---

### Task 6: Update AGENTS.md

Same two changes as CLAUDE.md.

**Files:**
- Modify: `flaim/AGENTS.md`

**Step 1: Fix Documentation Routing line**

In the `## Documentation Routing` section, find:
```
- Permanent docs live in `docs/`; temporal, in-progress docs live in `docs/dev/`.
```

Replace with:
```
- Permanent docs live in `docs/`. `docs/dev/` contains static dated research/analysis artifacts only — not a working set of living docs.
```

**Step 2: Simplify Linear-First protocol**

Apply the same two changes as Task 5 Step 2 to the `## Task Tracking Protocol (Linear-First)` section in AGENTS.md.

**Step 3: Commit**

```bash
cd /Users/ggugger/Code/flaim
git add AGENTS.md
git commit -m "docs: update AGENTS.md doc routing and simplify Linear-First protocol"
```

---

### Task 7: Update GEMINI.md

Same two changes as CLAUDE.md and AGENTS.md.

**Files:**
- Modify: `flaim/GEMINI.md`

**Step 1: Fix Documentation Routing line**

In the `## Documentation Routing` section, find:
```
- Permanent docs live in `docs/`; temporal, in-progress docs live in `docs/dev/`.
```

Replace with:
```
- Permanent docs live in `docs/`. `docs/dev/` contains static dated research/analysis artifacts only — not a working set of living docs.
```

**Step 2: Simplify Linear-First protocol**

Apply the same two changes as Task 5 Step 2 to the `## Task Tracking Protocol (Linear-First)` section in GEMINI.md.

**Step 3: Commit**

```bash
cd /Users/ggugger/Code/flaim
git add GEMINI.md
git commit -m "docs: update GEMINI.md doc routing and simplify Linear-First protocol"
```

---

### Task 8: Update flaim-eval/docs/INDEX.md

Remove the cross-repo tracker reference.

**Files:**
- Modify: `flaim-eval/docs/INDEX.md`

**Step 1: Find and update the ownership boundary section**

Find:
```
- Cross-repo execution tracker lives at `../flaim/docs/dev/CURRENT-EXECUTION-STATE.md`.
```

Replace with:
```
- Active tasks tracked in Linear (Flaim team).
```

**Step 2: Commit**

```bash
cd /Users/ggugger/Code/flaim-eval
git add docs/INDEX.md
git commit -m "docs: replace CURRENT-EXECUTION-STATE reference with Linear"
```

---

### Task 9: Update flaim-marketing/README.md

Strip the "In progress" task items from the "What I'm Doing Right Now" section.

**Files:**
- Modify: `flaim-marketing/README.md`

**Step 1: Remove "In progress" block**

Find and delete:
```markdown
**In progress:**
- Directory submissions (some done, some pending — see `strategy/MARKETING-PLAN.md`)
- GitHub README polish (demo GIF, topics, structure)
```

These are tracked as FLA-20, FLA-21, FLA-22, FLA-23 in Linear.

**Step 2: Commit**

```bash
cd /Users/ggugger/Code/flaim-marketing
git add README.md
git commit -m "docs: strip task items from README (tracked in Linear)"
```

---

### Task 10: Verify and smoke test

Confirm no task lists remain anywhere across the four repos.

**Step 1: Search for residual task content**

```bash
grep -rn "^\- \[ \]" /Users/ggugger/Code/flaim /Users/ggugger/Code/flaim-eval /Users/ggugger/Code/flaim-marketing /Users/ggugger/Code/flaim-submissions 2>/dev/null | grep -v ".git"
```

Expected: no results (or only results inside `docs/plans/` design docs, which is fine).

```bash
grep -rn "CURRENT-EXECUTION-STATE" /Users/ggugger/Code/flaim /Users/ggugger/Code/flaim-eval 2>/dev/null | grep -v ".git" | grep -v "docs/plans/"
```

Expected: no results.

```bash
grep -rn "docs/dev/TODO" /Users/ggugger/Code/flaim 2>/dev/null | grep -v ".git" | grep -v "docs/plans/"
```

Expected: no results.

**Step 2: Verify docs/dev/ contains only research files**

```bash
ls /Users/ggugger/Code/flaim/docs/dev/
```

Expected: only dated research files (`2026-02-*.md`), no `TODO.md` or `CURRENT-EXECUTION-STATE.md`.

**Step 3: Spot-check INDEX.md source-of-truth table**

Read `flaim/docs/INDEX.md` and confirm:
- No Backlog row
- No CURRENT-EXECUTION-STATE.md row
- Linear row present
- Dev Docs section renamed to "Research Archive"

Done. No final commit needed — this is a verification step only.
