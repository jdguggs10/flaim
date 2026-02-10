# Current Execution State

Last updated: 2026-02-10
Owner: Flaim (solo)

This is the canonical execution-status page for current work. It replaces overlapping sprint/incident plans that were moved to the external archive bundle (see `docs/archive/README.md`).

## Snapshot

- Unified MCP service is live on `https://api.flaim.app/mcp`.
- Auth hardening and error taxonomy work from Sprint A are shipped.
- End-to-end eval execution is healthy (`9/9` scenarios completed on three consecutive fresh runs: `2026-02-08T22-39-03Z`, `2026-02-08T22-48-28Z`, `2026-02-09T11-53-41Z`).
- The previous OpenAI MCP `424` discovery failure is resolved.
- Automated submission preflight is passing (`eval` + `accept` + `presubmit`) on consecutive fresh runs.
- Manual OAuth token-lifecycle checks are complete for ChatGPT, Gemini CLI, Claude Code, and claude.ai.
- Vendor-doc revalidation is complete (see `docs/submissions/*`).
- Ready for directory submission (OpenAI submission is the next concrete action).

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
- Added missing `openWorldHint: false` and `destructiveHint: false` to all MCP tools (identified as common OpenAI rejection reason).
- Fresh full eval run passed: `2026-02-10T19-27-44Z` (`9/9`, `0` errors).
- Acceptance passed: `npm run accept -- 2026-02-10T19-27-44Z`.
- Presubmit passed: `npm run presubmit -- 2026-02-10T19-27-44Z` (`RESULT: PASS`).
- OpenAI organization verification initiated (status: in review).

## Next Actions

1. **[READY NOW]** Submit to OpenAI Apps Directory (packet ready, individual verification approved 2026-02-10: `docs/submissions/openai-app-submission.md`).
2. Decide Anthropic submission strategy (submit now vs delay).
3. Keep preflight evidence current if any auth/tool changes land.
4. ~~Submit to MCP Registry~~ — **Done** (published as `app.flaim/mcp` on 2026-02-10).
5. ~~Gemini CLI extension packaging~~ — **Done** (`gemini-extension.json` committed 2026-02-10; auto-indexes within ~1 week).
6. ~~Submit to community directories~~ — **Done** (2026-02-10): Glama (pending review), MCP.so (pending review), awesome-mcp-servers (PR #1918 open), PulseMCP (auto-indexing from official registry).

## Not Started / Deferred

1. Sprint C implementation
- Basketball/hockey handlers in ESPN and Yahoo clients remain unimplemented (currently return not-supported stubs).

2. Directory submission actions
- Anthropic and OpenAI packets are prepared, but submission execution is pending.
- Anthropic listing viability remains a product/policy decision point (see `docs/dev/TODO.md`).

## Current Execution Order

1. OpenAI submission.
2. Anthropic submission decision.

## Canonical Documents

- Facts and platform/tool status: `docs/STATUS.md`
- Active backlog: `docs/dev/TODO.md`
- Manual OAuth verification: `docs/MANUAL-OAUTH-RUNBOOKS.md`
- Submission packets: `docs/submissions/*`
- Historical implementation details: `docs/archive/README.md` and `docs/plans/README.md`

## Archived During Cleanup (Superseded)

- In-repo archive/plans markdown moved to external bundle:
  - `/Users/ggugger/Code/flaim-docs-archive/2026-02-08-repo-doc-cleanup/`
- Full file list:
  - `/Users/ggugger/Code/flaim-docs-archive/2026-02-08-repo-doc-cleanup/README.md`
