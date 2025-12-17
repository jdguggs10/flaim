# CLAUDE.md (Concise)

## Critical Context
- Solo, part-time developer; first production project.
- Goal: ship working features; avoid over-engineering or new infrastructure.
- Prefer boring, documented tech: Next.js, Vercel, Clerk, Cloudflare Workers, Supabase, TypeScript, Tailwind.

## Assistant Mandate
- Recommend simple, stable, well-documented solutions that fit current stack.
- Avoid complex patterns (microservices refactors, custom auth/state, fancy DevOps, bleeding-edge libs).
- One new concept at a time; aim for changes doable in 1–2 hours and easy to revert.

## Architecture (at a glance)
- Vercel Frontend: Next.js app in `/openai` (chat UI, onboarding, usage tracking).
- Cloudflare Workers: Auth worker (`/workers/auth-worker`), Sport MCP workers (`/workers/baseball-espn-mcp`, `/workers/football-espn-mcp`).
- Supabase: Data: Supabase Postgres tables `espn_credentials`, `espn_leagues`.
- LLM: OpenAI's new Responses API; NOT chat completions! DO NOT USE CHAT COMPLETIONS!
- Rule: Worker-to-worker calls use custom domain (`api.flaim.app`); Cloudflare blocks `.workers.dev` to `.workers.dev` fetches with error 1042.

## MCP Tools
- Baseball: `get_espn_league_info`, `get_espn_team_roster`, `get_espn_matchups`.
- Football: `get_espn_football_league_info`, `get_espn_football_team`, `get_espn_football_matchups`, `get_espn_football_standings`.

## Development Commands
```bash
npm run dev              # All services locally
npm run dev:frontend     # Next.js only
npm run dev:workers      # All workers via wrangler dev
npm run deploy:workers:preview
npm run deploy:workers:prod
npm run build            # Frontend build
npm run lint             # ESLint (frontend)
```
Per-worker dev (ports 8786/8787/8788): `wrangler dev --env dev --port <port>`.

## Security & Auth
- Clerk JWT verification in auth-worker (JWKS, cached); prod rejects header spoofing.
- MCP workers forward `Authorization`; auth-worker alone validates tokens.
- ESPN creds stored only in Supabase; never re-sent to clients after setup.

## Decision Checklist
1) Can it be done in 1–2 hours with current tools?
2) Uses existing stack (Next.js, Clerk, CF Workers, Supabase)?
3) Backed by official docs/examples?
4) Easy to roll back?
5) Solves an immediate need (not future-proofing)?

If any "no": find a simpler alternative.

## Red Flags
- Adds services/infra or multiple new tools at once.
- Large refactors, build-tool changes, custom auth/state/caching/monitoring.
- "Future-proof" work without a current problem.

## When Stuck
- Check official docs/examples first; keep changes small; revert to last good state if needed.
- Focus on user impact; pause new features to fix breakage.
