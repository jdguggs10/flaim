# TODO

Last updated: 2026-02-09

Use this as the active backlog only. For overall phase status, see `docs/dev/CURRENT-EXECUTION-STATE.md`.

## Immediate (Current Gate)

1. Submit to OpenAI Apps Directory.

2. Decide Anthropic submission strategy.
- Submit now vs delay based on directory fit.

3. Keep submission preflight evidence current.
- Latest full PASS run: `2026-02-09T11-53-41Z`.
- Re-run preflight if auth/tool code changes, or if evidence is older than 7 days at submission time.

## Next (Sprint C Candidate)

1. Add basketball support (ESPN + Yahoo) for all read tools.
2. Add hockey support (ESPN + Yahoo) for all read tools.
3. Add tool/eval scenarios covering basketball and hockey.

## Maintenance / Reliability

1. Add external uptime checks for `/health` endpoints.
2. Improve preview OAuth callback handling for dynamic Vercel preview URLs.
3. Add deeper integration tests only where recent regressions justify it.

## Deferred / Long-Term

1. Additional fantasy platforms (Sleeper, CBS, others).
2. iOS app.
3. Browser-extension-driven connector automation.

## Recent Verification Notes

- `flaim-eval` fresh run `2026-02-09T11-53-41Z` passed end-to-end: `eval`, `accept`, and `presubmit`.
- `flaim-eval` fresh run `2026-02-08T22-39-03Z` passed end-to-end: `eval`, `accept`, and `presubmit`.
- `flaim-eval` fresh run `2026-02-08T22-48-28Z` also passed end-to-end: `eval`, `accept`, and `presubmit`.
- Previous same-day run `2026-02-08T20-37-44Z` also remains `PASS` with `eval`, `enrich`, `accept`, and `presubmit`.
- OpenAI screenshot evidence captured for OAuth + ChatGPT tool outputs (`get_user_session`, `get_standings`, `get_roster`) in:
  - `docs/submissions/openai-screenshots/02-oauth-flow-flaim-signin.png`
  - `docs/submissions/openai-screenshots/05-chatgpt-user-session-response.png`
  - `docs/submissions/openai-screenshots/06-chatgpt-standings-tool-response.png`
  - `docs/submissions/openai-screenshots/07-chatgpt-roster-tool-response.png`
- ChatGPT token-lifecycle evidence captured in:
  - `docs/submissions/openai-screenshots/08-chatgpt-post-revoke-error.png`
  - `docs/submissions/openai-screenshots/09-chatgpt-reauth-connected.png`
  - `docs/submissions/openai-screenshots/10-chatgpt-post-reauth-tool-success.png`
- Latest cross-client revoke executed: `POST /api/oauth/revoke-all` on `2026-02-09` (`revokedCount: 3`).
