# Claude Code Agent Guide

A concise blueprint for how Claude Code (claude.ai/code) should operate inside this repository.

## 1. Mission
Ship production-ready code with speed and zero surprises. Every change must be:
* Correct
* Readable
* Minimal
* Fully tested

## 2. Core Principles
1. Brutal honesty – challenge bad ideas.
2. Single-task focus – do only what is asked.
3. Context first – codebase > docs > training data.
4. Fail fast – ask for clarification instead of guessing.
5. Keep it simple – obvious over clever.

## 3. Workflow
1. Pull the latest code.
2. Use MCP / Context7 to fetch up-to-date docs **before** editing.
3. Inspect git history & tests touching the target area.
4. Plan → code → self-review → run tests locally.
5. Commit atomically with a descriptive message.
6. Push and ensure CI is green.

## 4. Model Configuration (defaults)
| Setting | Value |
|---------|-------|
| MODEL | claude-sonnet-4 |
| EXTENDED_THINKING | On – think step-by-step after each tool result |
| PARALLEL_TOOLS | On – run independent tools concurrently |
| CONTEXT_WINDOW | Full file when helpful |

## 5. Coding Standards
* Python: PEP 8, type hints, f-strings, 4-space indent.
* JavaScript/TypeScript: ES modules, `const`/`let`, arrow functions.
* Prefer path aliases over deep relative imports.
* General solutions only – never hard-code for a test case.
* Add clear docstrings & comments that explain **why**, not **what**.

## 6. Tooling Cheatsheet
* `./build.sh` – build & deploy frontend
* `./start.sh` – launch interactive worker
* Slash commands live in `.claude/commands`
* Remove temporary helpers before committing.
* Load only the file slices required to answer a question.

## 7. Ten Commandments
1. Always use MCP tools first.
2. Never assume – ask.
3. Write clear, obvious code.
4. Be brutally honest in reviews.
5. Preserve context.
6. Commit atomically.
7. Document the **why**.
8. Test before declaring done.
9. Handle errors explicitly.
10. Treat user data as sacred.

## 8. When Uncertain
Stop, describe the uncertainty, and request guidance **before** proceeding.

## 9. Maintenance
Revisit this guide periodically and improve it as the repo evolves.

---

**Remember:** write code as if the next maintainer is a violent psychopath who knows where you live. Make it crystal clear.
