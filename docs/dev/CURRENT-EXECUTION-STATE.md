# Current Execution State

Last updated: 2026-02-08
Owner: Flaim (solo)

This is the canonical execution-status page for current work. It replaces the recent overlapping sprint/incident plans that were moved to `docs/archive/`.

## Snapshot

- Unified MCP service is live on `https://api.flaim.app/mcp`.
- Auth hardening and error taxonomy work from Sprint A are shipped.
- End-to-end eval execution is healthy again (`9/9` scenarios completed on run `2026-02-08T16-00-07Z`).
- The previous OpenAI MCP `424` discovery failure is resolved.
- Remaining gate is eval acceptance coverage policy (`accept`/`presubmit` still fail on missing worker coverage in some traces).

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

## In Progress

1. Eval acceptance reliability (highest priority)
- `npm run eval` succeeds, but `npm run accept`/`npm run presubmit` fail for coverage reasons.
- Current failing reasons include:
  - `MISSING_AUTH_WORKER`
  - `MISSING_FANTASY_MCP`
  - `DOWNSTREAM_COVERAGE_ESCALATION`
- This is now the main blocking gate before submission readiness.

2. Submission-readiness verification
- Manual OAuth runbook execution still needs to be run and checked off for each target client.
- OpenAI submission packet screenshot checklist is still incomplete.

## Not Started / Deferred

1. Sprint C implementation
- Basketball/hockey handlers in ESPN and Yahoo clients remain unimplemented (currently return not-supported stubs).

2. Directory submission actions
- Anthropic and OpenAI packets are prepared, but submission execution is pending.
- Anthropic listing viability remains a product/policy decision point (see `docs/dev/TODO.md`).

3. Optional Gemini extension packaging
- Deferred; not required for current distribution baseline.

## Current Execution Order

1. Fix acceptance coverage gaps so `accept` and `presubmit` pass on full runs.
2. Run two consecutive clean eval cycles (`eval` + `accept` + `presubmit`).
3. Execute manual OAuth runbooks and record outcomes.
4. Finish OpenAI screenshot checklist.
5. Decide Anthropic submission strategy (submit now vs delay).

## Canonical Documents

- Facts and platform/tool status: `docs/STATUS.md`
- Active backlog: `docs/dev/TODO.md`
- Manual OAuth verification: `docs/MANUAL-OAUTH-RUNBOOKS.md`
- Submission packets: `docs/submissions/*`
- Historical implementation details: `docs/archive/*`

## Archived During Cleanup (Superseded)

- `docs/archive/plugins-buildout-plan.md`
- `docs/archive/mcp-eval-observability-scope.md`
- `docs/archive/openai-mcp-424-investigation-2026-02-08.md`
- `docs/archive/2026-02-06-mcp-eval-harness.md`
- `docs/archive/2026-02-06-eval-trace-observability-plan.md`
- `docs/archive/2026-02-06-sprint-a-auth-hardening-plan.md`
- `docs/archive/2026-02-07-eval-observability-remediation-plan.md`
- `docs/archive/2026-02-07-sprint-b-testing-packaging-plan.md`
