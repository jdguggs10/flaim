# Current Execution State

Last updated: 2026-02-24
Owner: Flaim (solo)

This is the canonical execution-status page for current work. It replaces overlapping sprint/incident plans that were moved to the external archive bundle (see `../flaim-docs-archive/2026-02-08-repo-doc-cleanup/README.md`).

## Snapshot

- Unified MCP service is live on `https://api.flaim.app/mcp`.
- Auth hardening and error taxonomy work from Sprint A are shipped.
- End-to-end eval execution is healthy (latest fresh run `2026-02-24T00-56-48Z`: `17/17`, `0` errors; `accept` and `presubmit` PASS).
- The previous OpenAI MCP `424` discovery failure is resolved.
- Automated submission preflight is passing (`eval` + `accept` + `presubmit`) on consecutive fresh runs.
- Manual OAuth token-lifecycle checks are complete for ChatGPT, Gemini CLI, Claude Code, and claude.ai.
- Vendor-doc revalidation is complete (see `../submissions/*`).
- `get_transactions` is shipped in the unified gateway and all platform clients with explicit v1 caveats.
- Submission remains close to ready, but eval + submission evidence should be refreshed to include `get_transactions`.

## Completed Recently

1. Auth and protocol hardening foundation (Sprint A scope)
- PKCE + redirect + resource/audience enforcement hardening.
- Tool auth metadata and auth-error signaling cleanup.
- Centralized error-code taxonomy and shared usage in workers.

2. Testing and packaging foundation (Sprint B scope, mostly complete)
- Manual OAuth runbooks exist for Claude, ChatGPT, Gemini CLI.
- Directory submission packets exist for Anthropic and OpenAI.
- Tool versioning policy exists.
- `flaim-eval` negative/adversarial scenarios and `presubmit` command are in place.

3. MCP 424 incident remediation (2026-02-08)
- `/mcp` and `/fantasy/mcp` non-POST requests now return `405` (no hanging GET path).
- MCP handler uses stream mode for connector compatibility (`enableJsonResponse: false`).
- Tool security metadata shape normalized to canonical array form.
- Production deploy and CI are green.

4. Submission preflight reruns (2026-02-08)
- Fresh full eval run passed: `2026-02-08T22-39-03Z` (`9/9`, `0` errors).
- Acceptance passed: `npm run accept -- 2026-02-08T22-39-03Z`.
- Presubmit passed: `npm run presubmit -- 2026-02-08T22-39-03Z` (`RESULT: PASS`).
- Second consecutive fresh full eval run passed: `2026-02-08T22-48-28Z` (`9/9`, `0` errors).
- Acceptance passed: `npm run accept -- 2026-02-08T22-48-28Z`.
- Presubmit passed: `npm run presubmit -- 2026-02-08T22-48-28Z` (`RESULT: PASS`).

5. Submission preflight rerun (2026-02-09)
- Fresh full eval run passed: `2026-02-09T11-53-41Z` (`9/9`, `0` errors).
- Acceptance passed: `npm run accept -- 2026-02-09T11-53-41Z`.
- Presubmit passed: `npm run presubmit -- 2026-02-09T11-53-41Z` (`RESULT: PASS`).

6. Tool annotations fixed and verified (2026-02-10)
- Added missing `openWorldHint: true` and `destructiveHint: false` to all MCP tools (identified as common OpenAI rejection reason).
- Fresh full eval run passed: `2026-02-10T19-27-44Z` (`9/9`, `0` errors).
- Acceptance passed: `npm run accept -- 2026-02-10T19-27-44Z`.
- Presubmit passed: `npm run presubmit -- 2026-02-10T19-27-44Z` (`RESULT: PASS`).
- OpenAI organization verification initiated (status: in review).

8. Sleeper Phase 2 (2026-02-24)
- `get_free_agents` added for Sleeper NFL and NBA; routed through unified gateway.
- KV-backed player index cache (`SLEEPER_PLAYERS_CACHE`) with 24h TTL; falls back to in-memory when KV unavailable.
- Sleeper transactions now enriched with player name/position/team from cached index.
- KV namespaces created and wired into all sleeper-client wrangler configs (prod + preview).
- All sleeper-client and targeted fantasy-mcp tests pass (43 + 47 tests); type-check clean.

7. Transactions tool rollout (2026-02-23)
- `get_transactions` shipped in unified gateway (`fantasy-mcp`) and ESPN/Yahoo/Sleeper clients.
- Tool contract and docs updated for v1 behavior:
  - ESPN/Sleeper honor explicit `week`; default to current + previous week when omitted.
  - Yahoo ignores explicit `week` and uses a recent 14-day timestamp window.
  - Yahoo `type=waiver` filtering is intentionally unsupported in v1.
- Phase 2 enrichments are explicitly deferred:
  - ESPN `mTransactions2` enrichment
  - Yahoo pending-waiver/pending-trade team fan-out
  - Sleeper player-name enrichment aligned with Sleeper free-agents work

## Next Actions

1. Capture and attach `get_transactions` screenshots/evidence in the submission packets.
2. **[READY NEXT]** Submit to OpenAI Apps Directory. Remaining external step is setting `OPENAI_APPS_VERIFICATION_TOKEN` when OpenAI issues it during submission. See `../submissions/openai-app-submission.md`.
3. Decide Anthropic submission strategy (submit now vs delay).
4. Keep preflight evidence current if any auth/tool changes land.
4. ~~Submit to MCP Registry~~ — **Done** (published as `app.flaim/mcp` on 2026-02-10).
5. ~~Gemini CLI extension packaging~~ — **Done** (`gemini-extension.json` committed 2026-02-10; auto-indexes within ~1 week).
6. ~~Submit to community directories~~ — **Done** (2026-02-10): Glama (pending review), MCP.so (pending review), awesome-mcp-servers (PR #1918 open), PulseMCP (auto-indexing from official registry).

7. Basketball & Hockey buildout (2026-02-10, shipped 2026-02-13)
- Added basketball and hockey handlers to both ESPN and Yahoo clients (5 tools each, 4 sport-platform combos = 20 new handler routes).
- ESPN mappings sourced from `cwendt94/espn-api` Python library; marked unverified pending live league credentials.
- Yahoo mappings use human-readable position strings (no ID research needed).
- ESPN onboarding gate expanded to include basketball and hockey.
- Deployed to production 2026-02-13.

8. OpenAI submission prep (2026-02-16)
- Demo account (`demo@flaim.app`) created with password auth via Clerk for reviewer access.
- Domain verification route (`/.well-known/openai-apps-challenge`) added to `fantasy-mcp`; reads token from `OPENAI_APPS_VERIFICATION_TOKEN` Wrangler secret.
- Submission packet fully updated: demo account section, domain verification instructions, basketball/hockey status corrected, checklist refreshed.
- Submission packet status: ready to submit.

9. Submission readiness recheck (2026-02-19)
- Fresh full eval run passed: `2026-02-19T13-39-48Z` (`9/9`, `0` errors).
- Enrichment passed: `npm run enrich -- 2026-02-19T13-39-48Z` (`9/9` traces).
- Acceptance passed: `npm run accept -- 2026-02-19T13-39-48Z`.
- Presubmit passed: `npm run presubmit -- 2026-02-19T13-39-48Z` (`RESULT: PASS`).

10. Terms of Service page published (2026-02-20)
- `/terms` page live at `https://flaim.app/terms`.
- Footer, sitemap, and CONNECTOR-DOCS updated with Terms link.
- OpenAI submission packet updated (step 3 and dashboard checklist item checked off).

## Not Started / Deferred

1. ~~Sprint C implementation~~ — **Done** (basketball/hockey buildout shipped to prod 2026-02-13).

2. Directory submission actions
- Anthropic and OpenAI packets are prepared, but submission execution is pending.
- Anthropic listing viability remains a product/policy decision point (see `docs/dev/TODO.md`).

## Current Execution Order

1. OpenAI submission.
2. Anthropic submission decision.

## Canonical Documents

- Facts and platform/tool status: `docs/STATUS.md`
- Active backlog: `docs/dev/TODO.md`
- Manual OAuth verification (private): `../submissions/internal-docs/MANUAL-OAUTH-RUNBOOKS.md`
- Submission packets: `../submissions/*`
- Historical implementation details: `docs/plans/README.md` and `../flaim-docs-archive/2026-02-08-repo-doc-cleanup/README.md`

## Archived During Cleanup (Superseded)

- In-repo archive/plans markdown moved to external bundle:
  - `../flaim-docs-archive/2026-02-08-repo-doc-cleanup/`
- Full file list:
  - `../flaim-docs-archive/2026-02-08-repo-doc-cleanup/README.md`
