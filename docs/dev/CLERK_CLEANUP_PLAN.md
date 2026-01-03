# Clerk/JWT Cleanup Plan (Jan 3, 2026)

Scope: cleanup **unused dependencies, env vars, and docs** around Clerk backend usage after the shift to auth-worker JWKS verification + OAuth support. No behavior changes intended.

## Findings (what looks unnecessary today)
- `@clerk/backend` dependency is declared (root + MCP workers) but **never imported** anywhere in the repo.
- `CLERK_SECRET_KEY` is listed for MCP workers and auth-worker in docs/env interfaces, but **never read** in code.
- `workers/auth-worker/src/interfaces.ts` defines shared auth interfaces but **has zero imports**.
- Multiple docs still claim **header-based Clerk auth** or **Clerk verification inside MCP workers**, which is no longer accurate.

## Cleanup Plan (small + reversible)

### 1) Remove `@clerk/backend` dependency from root and MCP workers
**Why valid:** `rg "@clerk/backend"` shows no runtime imports; JWT verification is custom JWKS in auth-worker.  
**What went awry:** Dependency was added for server-side verification, but later replaced by JWKS verification in auth-worker and never removed.  
**Notes:** After removal, run `npm install` once to update lockfile. If any future server-side Clerk API use is reintroduced, add it back locally where needed.

### 2) Remove `CLERK_SECRET_KEY` from MCP workers/auth-worker env docs and Env interfaces
**Why valid:** Not referenced in any worker code. Auth-worker uses JWKS from the JWT `iss` and OAuth tokens for auth, not Clerk secret.  
**What went awry:** The variable stayed from earlier Clerk backend verification attempts (or template docs).  
**Notes:** Keep `CLERK_SECRET_KEY` in **web** docs and `.env.example` since Next.js uses Clerk SDK on the frontend/server.

### 3) Update worker READMEs to match current auth flow
**Why valid:** Auth is now: **Next.js obtains Clerk JWT → auth-worker verifies JWKS → MCP workers forward Authorization**.  
**What went awry:** Docs didn’t get updated after the JWT verification migration and OAuth additions.  
**Notes:** Specific doc fixes:
- `workers/auth-worker/README.md`: replace “All credential endpoints require X‑Clerk‑User‑ID header” with “Authorization JWT required; X‑Clerk‑User‑ID only in dev fallback.”
- `workers/baseball-espn-mcp/README.md` + `workers/football-espn-mcp/README.md`: replace “Server‑side Clerk verification” with “Auth-worker validates tokens; MCP workers forward Authorization.”
- `workers/README.md`: remove `CLERK_SECRET_KEY` from env list; clarify auth flow and that `.workers.dev` must be used for auth-worker.

### 4) Remove unused `workers/auth-worker/src/interfaces.ts`
**Why valid:** File is unused and not imported; it adds confusion and suggests a shared auth abstraction that doesn’t exist.  
**What went awry:** Likely leftover from earlier multi-client auth plans/usage tracking.  
**Notes:** If a shared interface layer becomes needed later, reintroduce it closer to actual use.

## Optional “Nice to Have” (non-essential)
- Double-check archived docs for correctness only if you’re using them; otherwise leave archives untouched to preserve history.
- Add a brief note in `docs/ARCHITECTURE.md` that auth-worker validates **Clerk JWT + OAuth tokens**, and that `X‑Clerk‑User‑ID` is dev-only.

## Risk/Impact
- Low risk. Changes are dependency/documentation cleanup and removal of unused code.
- Behavior stays the same; only source-of-truth documentation becomes accurate.
