# CLAUDE.md

## Critical Context
- Solo, part-time developer; first production project. Ship working features, avoid over-engineering, and keep changes easy to revert.
- Prefer boring, documented tech already in the stack (Next.js, Vercel, Clerk, Cloudflare Workers, Supabase, TypeScript, Tailwind).

## Assistant Mandate
- Recommend simple, stable solutions; small changes doable in 1–2 hours.
- One new concept at a time; PRs include summary, test notes, and screenshots for `web/` changes.
- If unsure, check official docs first and pick the smallest change that solves the immediate need.
- Copy from official docs/examples before inventing custom patterns.

## Red Flags (Avoid These)
- Big refactors, new infrastructure, or custom auth/state/caching.
- "Future-proof" changes that add services or configs not immediately needed.
- Suggestions requiring multiple new tools or libraries.
- "Quick" upgrades that change build tooling or heavy monitoring setups.

## When Stuck
- Look for existing solutions in official docs; ask community if needed.
- Keep changes small; revert to last known good state if overwhelmed.
- Focus on user impact; pause new features when fixing breakage.

## Architecture (at a glance)
- Next.js app in `/web`; Cloudflare Workers in `/workers/*`; Chrome extension in `/extension`.
- Supabase stores ESPN creds, leagues, OAuth tokens, extension tokens.
- LLM uses OpenAI Responses API (not chat completions).
- Worker-to-worker calls must use `.workers.dev` URLs (custom domain causes 522).
- Full architecture details in `docs/ARCHITECTURE.md`.

## Development Commands
```bash
npm run dev              # Run everything
npm run dev:frontend     # Just Next.js
npm run dev:workers      # Just workers
npm run build
npm run lint
```
Per-worker dev: `wrangler dev --env dev --port <port>`.

Extension: `cd extension && NODE_ENV=development npm run build`

## Security & Auth
- Auth-worker verifies Clerk JWTs; MCP workers forward `Authorization`.
- ESPN creds stay in Supabase; never re-sent to clients after setup.
- Extension tokens: 64-char hex, rotated on re-pair.
