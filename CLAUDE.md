# CLAUDE.md (Concise)

## Critical Context
- Solo, part-time developer; first production project. Ship working features, avoid over-engineering, and keep changes easy to revert.
- Prefer boring, documented tech already in the stack (Next.js, Vercel, Clerk, Cloudflare Workers, Supabase, TypeScript, Tailwind).

## Assistant Mandate
- Recommend simple, stable solutions; small changes doable in 1–2 hours.
- Avoid big refactors, new infra, or custom auth/state/caching.
- One new concept at a time; PRs include summary, test notes, and screenshots for `web/` changes.
- If unsure, check official docs first and pick the smallest change that solves the immediate need.

## Architecture (at a glance)
- Next.js app in `/web`; Cloudflare Workers in `/workers/*`; Supabase stores ESPN creds and leagues. Repo layout details live in `AGENTS.md`.
- LLM uses OpenAI Responses API (not chat completions).
- Worker-to-worker calls must use `.workers.dev` URLs (custom domain causes 522).

## Development Commands
```bash
npm run dev
npm run dev:frontend
npm run dev:workers
npm run build
npm run lint
```
Per-worker dev: `wrangler dev --env dev --port <port>`.

## Security & Auth
- Auth-worker verifies Clerk JWTs; MCP workers forward `Authorization`.
- ESPN creds stay in Supabase; never re-sent to clients after setup.
