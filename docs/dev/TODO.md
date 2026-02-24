# TODO
Last updated: 2026-02-24

Use this as the active backlog only. For overall phase status, see `docs/dev/CURRENT-EXECUTION-STATE.md`.

## Short-Term
1. Capture `get_transactions` screenshots/evidence and check off the transactions delta checklist.
2. Submit to OpenAI Apps Directory.
3. Decide Anthropic submission strategy.
- Submit now vs delay based on directory fit.
4. Keep submission preflight evidence current.

## Medium-Term 
1. Improve clerk magic link emails
2. Transactions Phase 2 enrichments:
- ESPN `mTransactions2` enrichment for richer bid/transaction detail.
- Yahoo pending waiver/pending trade team fan-out.
- Sleeper player-name enrichment (aligned with Sleeper free-agents work).
3. Add free agent support for Sleeper (phase 2 in /plans)
4. Add stat enrichment for Sleeper (phase 3 in /plans)

## Maintenance / Reliability
1. Add external uptime checks for `/health` endpoints.
2. Improve preview OAuth callback handling for dynamic Vercel preview URLs.
3. Add deeper integration tests only where recent regressions justify it.

## Deferred / Long-Term
1. Additional fantasy platforms beyond current support (Fantrax, others).
2. iOS app with Foundation Models + MCP (see `docs/dev/2026-02-22-ios-app-research.md` for full research, recommendations, and timeline).

## Recent Verification Notes
- `flaim-eval` fresh run `2026-02-24T00-56-48Z` passed end-to-end with transaction scenarios added: `eval` (`17/17`, `0` errors), `enrich`, `accept`, and `presubmit` (`RESULT: PASS`).
- `flaim-eval` fresh run `2026-02-09T11-53-41Z` passed end-to-end: `eval`, `accept`, and `presubmit`.
- `flaim-eval` fresh run `2026-02-08T22-39-03Z` passed end-to-end: `eval`, `accept`, and `presubmit`.
- `flaim-eval` fresh run `2026-02-08T22-48-28Z` also passed end-to-end: `eval`, `accept`, and `presubmit`.
- Previous same-day run `2026-02-08T20-37-44Z` also remains `PASS` with `eval`, `enrich`, `accept`, and `presubmit`.
- OpenAI screenshot evidence captured for OAuth + ChatGPT tool outputs (`get_user_session`, `get_standings`, `get_roster`) in:
  - `../submissions/openai-screenshots/02-oauth-flow-flaim-signin.png`
  - `../submissions/openai-screenshots/05-chatgpt-user-session-response.png`
  - `../submissions/openai-screenshots/06-chatgpt-standings-tool-response.png`
  - `../submissions/openai-screenshots/07-chatgpt-roster-tool-response.png`
- ChatGPT token-lifecycle evidence captured in:
  - `../submissions/openai-screenshots/08-chatgpt-post-revoke-error.png`
  - `../submissions/openai-screenshots/09-chatgpt-reauth-connected.png`
  - `../submissions/openai-screenshots/10-chatgpt-post-reauth-tool-success.png`
- Latest cross-client revoke executed: `POST /api/oauth/revoke-all` on `2026-02-09` (`revokedCount: 3`).
