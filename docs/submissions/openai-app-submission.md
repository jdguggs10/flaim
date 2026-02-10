# OpenAI App Submission Packet

Prepared for submission to the ChatGPT Apps Directory.

## Pre-submission verification checklist

Before submitting, re-verify this packet against official sources (policies change):

- [x] [Submission guide](https://developers.openai.com/apps-sdk/deploy/submission/) — confirm required fields match
- [x] [App submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines) — confirm review criteria
- [x] [MCP server concept](https://developers.openai.com/apps-sdk/concepts/mcp-server/) — confirm transport/auth requirements
- [x] [Auth docs](https://developers.openai.com/apps-sdk/build/auth/) — confirm OAuth flow requirements
- [x] [Connect from ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt) — confirm user-facing flow
- [x] Run manual OAuth runbook for ChatGPT (see `docs/MANUAL-OAUTH-RUNBOOKS.md`)
- [x] Run `npm run presubmit -- <run_id>` and confirm PASS (`2026-02-10T19-27-44Z`; prior PASS runs also recorded below)

**Last verified against official sources:** 2026-02-09 (revalidated based on prior verification on 2026-02-07; proceed unless OpenAI guidance has changed)

## Submission Record

- **Submitted:** 2026-02-10
- **Organization verification:** Individual verification approved 2026-02-10
- **Data residency:** Global (Flaim project)
- **Verification run:** `2026-02-10T19-27-44Z` (PASS)
- **Case ID:** [Add after submission]
- **Status:** Submitted - awaiting review

---

## Latest Verification Notes (2026-02-10)

- **Tool annotations updated** (2026-02-10):
  - Added `openWorldHint: false` to all tools (was missing - identified as common rejection reason)
  - Added `destructiveHint: false` to all tools (recommended for read-only tools)
  - All tools now have complete annotation set: `{ readOnlyHint: true, openWorldHint: false, destructiveHint: false }`
  - Change location: `workers/fantasy-mcp/src/mcp/server.ts:42`
- `flaim-eval` fresh run `2026-02-10T19-27-44Z` (with updated annotations):
  - `npm run eval` (`9/9 completed, 0 errored`)
  - `npm run accept -- 2026-02-10T19-27-44Z` (`PASS`)
  - `npm run presubmit -- 2026-02-10T19-27-44Z` (`RESULT: PASS — ready for submission`)
- `flaim-eval` fresh full runs passed with consecutive run ids:
  - `2026-02-08T22-39-03Z`:
    - `npm run eval`
    - `npm run accept -- 2026-02-08T22-39-03Z` (`PASS`)
    - `npm run presubmit -- 2026-02-08T22-39-03Z` (`RESULT: PASS — ready for submission`)
  - `2026-02-08T22-48-28Z`:
    - `npm run eval`
    - `npm run accept -- 2026-02-08T22-48-28Z` (`PASS`)
    - `npm run presubmit -- 2026-02-08T22-48-28Z` (`RESULT: PASS — ready for submission`)
- `flaim-eval` fresh run `2026-02-09T11-53-41Z`:
  - `npm run eval`
  - `npm run accept -- 2026-02-09T11-53-41Z` (`PASS`)
  - `npm run presubmit -- 2026-02-09T11-53-41Z` (`RESULT: PASS — ready for submission`)
- Previous run `2026-02-08T20-37-44Z` also remains fully passing (`eval` + `enrich` + `accept` + `presubmit`).
- ChatGPT manual OAuth flow completed in-browser (consent approved) and tool responses verified for:
  - `get_user_session`
  - `get_standings`
  - `get_roster`
- Screenshot evidence captured in `docs/submissions/openai-screenshots/` (linked below).
- ChatGPT token-lifecycle verification completed via forced revoke/re-auth cycle:
  - Revoked active OAuth connections from authenticated `flaim.app` session using `POST /api/oauth/revoke-all` (`revokedCount: 94`).
  - Subsequent ChatGPT tool call failed as expected with connector/tool-resource error (`Resource not found ... get_user_session`).
  - Reconnected app in ChatGPT settings and re-approved consent.
  - Reloaded chat session and confirmed `get_user_session` tool call succeeds again.
- Operational note for reruns: Google sign-in did not complete in Chrome for Testing; use regular Chrome with remote debugging and connect agent-browser through CDP.

---

## App Details

- **App name:** Flaim — Fantasy League AI Connector
- **Description:** Connect your ESPN and Yahoo fantasy sports leagues to ChatGPT. Ask about standings, rosters, matchups, free agents, and league info in natural conversation. Read-only access — Flaim never modifies your league data.
- **MCP server URL:** `https://api.flaim.app/mcp`
- **Category:** Sports / Productivity

## OAuth Configuration

- **Authorization URL:** `https://api.flaim.app/auth/authorize`
- **Token URL:** `https://api.flaim.app/auth/token`
- **Scopes:** `mcp:read`
- **PKCE:** Required (S256)
- **Dynamic client registration:** `https://api.flaim.app/auth/register`
- **Discovery:** `https://api.flaim.app/.well-known/oauth-authorization-server`

## Links

- **Privacy policy:** https://flaim.app/privacy
- **Support contact:** privacy@flaim.app
- **Website:** https://flaim.app
- **Connector docs (setup + examples):** `docs/CONNECTOR-DOCS.md`
- **Documentation URL (for submission form):** https://github.com/jdguggs10/flaim/blob/main/docs/CONNECTOR-DOCS.md

## Content Security Policy

Flaim fetches data from the following domains:
- `https://api.flaim.app` — MCP server and OAuth endpoints
- `https://flaim.app` — Consent page and user dashboard

No external domains are contacted from the MCP server beyond ESPN and Yahoo APIs (server-side only, not client-facing).

## Test Instructions (Slim)

Full setup + prompts live in `docs/CONNECTOR-DOCS.md`. For a quick reviewer pass:

1. Create account: https://flaim.app
2. Connect ESPN via the Chrome extension (or manual cookie entry)
3. Confirm leagues + default at https://flaim.app/leagues
4. Connect MCP server in ChatGPT: `https://api.flaim.app/mcp`
5. Prompts:
   - "What fantasy leagues do I have?"
   - "Show me the standings in my default league"
   - "Who is on my roster in my default league?"

## Screenshots

Note: screenshots are stored locally in `docs/submissions/openai-screenshots/` and are not required to be committed to the public repo. Attach as needed during submission/review.

- [x] Create-app form: `docs/submissions/openai-screenshots/00-create-app-form.png`
- [x] Create-app ready state: `docs/submissions/openai-screenshots/01-create-app-ready.png`
- [x] OAuth consent flow (browser authorization page): `docs/submissions/openai-screenshots/02-oauth-flow-flaim-signin.png`
- [x] ChatGPT showing `get_user_session` results: `docs/submissions/openai-screenshots/05-chatgpt-user-session-response.png`
- [x] ChatGPT showing standings data: `docs/submissions/openai-screenshots/06-chatgpt-standings-tool-response.png`
- [x] ChatGPT showing roster data: `docs/submissions/openai-screenshots/07-chatgpt-roster-tool-response.png`

Token-lifecycle supplemental evidence:
- `docs/submissions/openai-screenshots/08-chatgpt-post-revoke-error.png`
- `docs/submissions/openai-screenshots/09-chatgpt-reauth-connected.png`
- `docs/submissions/openai-screenshots/10-chatgpt-post-reauth-tool-success.png`

## Known Limitations

- **Platforms:** ESPN and Yahoo only (Sleeper, CBS, etc. not supported)
- **Sports:** Football and baseball (basketball and hockey planned)
- **ESPN credentials:** Session cookies expire ~30 days; user must re-sync
- **Yahoo tokens:** Auto-refresh via OAuth; occasional manual re-auth
- **Read-only:** No trades, adds, drops, or league modifications
- **Rate limit:** 200 MCP calls per day per user

## Safety & Privacy

- All tools are read-only with tool annotations: `readOnlyHint: true`, `openWorldHint: false`, `destructiveHint: false`
- No PII collected beyond what's needed for authentication
- ESPN/Yahoo credentials encrypted at rest (Supabase AES-256)
- Per-user data isolation via verified JWT claims
- 200 calls/day rate limit per user
- No data shared with third parties

## Support Policy

Solo indie project with best-effort support:
- **Bug reports:** [GitHub Issues](https://github.com/jdguggs10/flaim/issues)
- **Email:** privacy@flaim.app
- **Response time:** Best-effort; typically within a few days

## Post-Publication Notes

Per OpenAI policy, tool names, signatures, and descriptions are locked after publication. Changes to tool contracts require resubmission. See `docs/TOOL-VERSIONING.md` for our versioning policy.
