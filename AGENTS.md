# Repo Agent Guide

This file provides public, repo-scoped guidance to AI coding agents working in this repository.

> **Sync:** `AGENTS.md` and `CLAUDE.md` at the repo root should stay identical.

## Scope

This repository is the public main repo for Flaim:

- Next.js web app
- Cloudflare Workers
- Chrome extension
- Public documentation
- Shipped product-facing agent assets

Flaim also has other repositories and private workspaces for chat, evaluation, runner workflows, and operational work. This guide only covers the current repository.

Use this file for repo-local engineering guidance only. Do not treat it as a place for private workspace notes, personal operating habits, local filesystem paths, credentials, Notion links, or internal task tracking.

## Public/Private Boundary

- This repo is public. Keep comments, docs, and agent-facing instructions public-safe.
- Do not reference private sibling folders, private local paths, or unpublished operational material from this repo.
- If a task depends on private context that is not present in the repository, state the gap clearly and ask for a distilled brief instead of guessing.

## Important Distinction: Product Assets vs Repo Instructions

The `.agents/skills/` directory contains shipped product assets for Flaim, including:

- `.agents/skills/flaim-fantasy/`
- `.agents/skills/activity-brief/`
- `.agents/skills/analyze-matchup/`

These files are part of the product surface. They are not general repository instructions for contributors.

Only read or modify those skill files when the task is explicitly about:

- shipped prompt or skill behavior
- user-facing fantasy-analysis behavior
- the MCP tool contract
- plugin packaging or distribution of Flaim's agent assets

For normal engineering tasks in the web app, workers, extension, or docs, do not treat the shipped skill files as contributor instructions.

Likewise, `.mcp.json` is a product configuration artifact. Use it when the task explicitly concerns Flaim's MCP integration or product behavior, not as default repo guidance for every task.

## Start Here

Before making non-trivial changes, load:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/INDEX.md`

Then load the area-specific entry point if relevant:

- `web/README.md`
- `workers/README.md`
- `extension/README.md`

## Stack

- Node `24` (see `.nvmrc`)
- `pnpm` workspace (`packageManager: pnpm@10`)
- Next.js web app in `web/`
- Cloudflare Workers in `workers/`
- Chrome extension in `extension/`

Prefer `corepack pnpm ...` from the repo root unless a package README says otherwise.

## Working Rules

- Preserve the public/private boundary. Public repo docs should only describe what is true in this codebase.
- Worker-to-worker calls must use `.workers.dev` URLs, not custom domains.
- Be explicit about repo-local limits. If a task appears to depend on sibling repos, private workspace context, or broader Flaim decisions that are not present here, say so instead of guessing.

## Verification

Run the narrowest relevant checks for the area you changed.

Common examples:

- repo-level dev/build/lint: `corepack pnpm run dev`, `corepack pnpm run build`, `corepack pnpm run lint`
- web typecheck: `corepack pnpm --dir web exec tsc --noEmit`
- UI token check: `corepack pnpm run ui:check`
- affected worker tests/typecheck: run the package-local test and typecheck commands in the changed worker directory

Do not claim success if you did not run the relevant checks.

## Documentation Updates

Update public docs in this repo when code-coupled behavior changes.

Good examples:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/INDEX.md`
- area READMEs under `web/`, `workers/`, or `extension/`

Do not add private implementation plans, TODO lists, or internal project tracking to repo docs.

## Cloud-Agent Reality

Cloud coding agents may only see repository contents plus the task prompt and configured environment. They may not have access to your local plugins, private workspace files, or personal development setup.

Write and maintain this file so a cloud agent can still do useful repo-contained work without relying on hidden local context.
