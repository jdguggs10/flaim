# TODO

Last updated: 2026-02-08

Use this as the active backlog only. For overall phase status, see `docs/dev/CURRENT-EXECUTION-STATE.md`.

## Immediate (Current Gate)

1. Make eval acceptance pass reliably on full runs.
- Resolve missing-worker coverage failures in `flaim-eval` acceptance (`MISSING_AUTH_WORKER`, `MISSING_FANTASY_MCP`, downstream escalation).
- Goal: two consecutive clean runs of `eval` + `accept` + `presubmit`.

2. Finish submission preflight checks.
- Run manual OAuth runbooks for Claude, ChatGPT, and Gemini.
- Complete OpenAI packet screenshot checklist.
- Re-verify vendor submission docs within 7 days of submission.

3. Set Anthropic submission strategy.
- Decide whether to submit now or delay based on likely directory review fit.

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
