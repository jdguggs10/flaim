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
- [x] Run `npm run presubmit -- <run_id>` and confirm PASS (`2026-02-19T13-39-48Z`; prior PASS runs also recorded below)
- [x] Tool annotations: `readOnlyHint`, `openWorldHint`, `destructiveHint` all set (2026-02-10)
- [x] Demo account configured: `demo@flaim.app` with password auth, ESPN credentials synced, default league set
- [x] Domain verification route deployed: `/.well-known/openai-apps-challenge` reads from `OPENAI_APPS_VERIFICATION_TOKEN` secret
- [x] Basketball and hockey support shipped (2026-02-13)
- [x] Demo-account eval re-verified end-to-end for submission readiness (`eval` + `enrich` + `accept` + `presubmit` PASS on `2026-02-19T13-39-48Z`)
- [ ] Set `OPENAI_APPS_VERIFICATION_TOKEN` secret when OpenAI provides the token during submission
- [x] Verify demo account login works end-to-end in ChatGPT before submitting (manual OAuth runbook complete; screenshots captured)

**Last verified against official sources:** 2026-02-19

---

## Submission Record

- **Organization verification:** Individual verification approved 2026-02-16
- **Data residency:** Global (Flaim project)
- **Latest verification run:** `2026-02-19T13-39-48Z` (PASS)
- **Case ID:** [Add after submission]
- **Status:** Ready to submit (pending OpenAI-provided domain verification token at submission time)

---

## Remaining Steps To Submit

1. In the OpenAI submission flow, copy the provided challenge token and set `OPENAI_APPS_VERIFICATION_TOKEN` in Cloudflare prod (`workers/fantasy-mcp`) before final submit.
2. Submit in the OpenAI dashboard and record the returned Case ID in this document.
3. ~~Publish a Terms of Service page at `https://flaim.app/terms` and use that URL in the submission form.~~ **Done** (2026-02-20)
4. ~~Upload an unlisted, no-login end-to-end demo recording (Developer Mode flow) and add its URL in the submission form.~~ **Done**: `https://youtu.be/Fw4JwqelEeQ`

## Final Dashboard Checks (Submission-Time)

- [ ] Submitter account has **Owner** role for the OpenAI Platform organization.
- [ ] MCP server URL entered in submission is the public production URL (`https://api.flaim.app/mcp`), not localhost/testing.
- [ ] OAuth metadata fields in dashboard match this packet (`authorize`, `token`, `register`, discovery endpoints).
- [ ] Privacy policy and support contact are present and valid in the submission form.
- [x] Terms of Service URL is populated with the production page (`https://flaim.app/terms`).
- [x] Demo Recording URL points to an **unlisted, no-login** end-to-end video covering main tools and OAuth in Developer Mode (`https://youtu.be/Fw4JwqelEeQ`).
- [ ] If requested by reviewer workflow, test credentials remain valid and accessible without extra friction (demo credentials + consent flow).

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
- **Demo Recording URL:** https://youtu.be/Fw4JwqelEeQ

## Content Security Policy

Flaim fetches data from the following domains:
- `https://api.flaim.app` — MCP server and OAuth endpoints
- `https://flaim.app` — Consent page and user dashboard

No external domains are contacted from the MCP server beyond ESPN and Yahoo APIs (server-side only, not client-facing).

## Domain Verification

OpenAI requires domain ownership verification during submission. The route is pre-deployed and reads the token from a Wrangler secret:

- **Endpoint:** `https://api.flaim.app/.well-known/openai-apps-challenge`
- **Implementation:** `workers/fantasy-mcp/src/index.ts` (returns `OPENAI_APPS_VERIFICATION_TOKEN` as plain text)

**During submission, when OpenAI provides the token:**
```bash
cd workers/fantasy-mcp
echo "<TOKEN_FROM_OPENAI>" | wrangler secret put OPENAI_APPS_VERIFICATION_TOKEN --env prod
```

No deploy needed — the route is already live; it just needs the secret value.

## Demo Account

A pre-configured demo account is provided with ESPN credentials already synced and default leagues set.

- **Email:** demo@flaim.app
- **Password:** 123flaim
- **Setup:** ESPN credentials pre-synced with active leagues; default league configured.
- **Auth method:** Password login enabled via Clerk (alongside magic link for regular users).

No additional signup, extension install, or credential entry is required — the account is ready to use.

## Test Instructions (Slim)

Full setup + prompts live in `docs/CONNECTOR-DOCS.md`. For a quick reviewer pass:

1. Connect MCP server in ChatGPT: `https://api.flaim.app/mcp`
2. When prompted, sign in with the demo account above (demo@flaim.app / 123flaim)
3. Approve the OAuth consent screen
4. Prompts:
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
- **Sports:** Football, baseball, basketball, and hockey
- **ESPN credentials:** Session cookies expire ~30 days; user must re-sync
- **Yahoo tokens:** Auto-refresh via OAuth; occasional manual re-auth
- **Read-only:** No trades, adds, drops, or league modifications
- **Rate limit:** 200 MCP calls per day per user

## Data Sources

Flaim retrieves the user's own fantasy league data from ESPN and Yahoo at the user's explicit request. All access is strictly read-only by design.

- **Yahoo:** OAuth 2.0 via Yahoo's Fantasy Sports API
- **ESPN:** User-provided session cookies (via Chrome extension or manual entry), stored encrypted (AES-256)

Flaim cannot make trades, add/drop players, or modify league data. No data is redistributed or shared with third parties.

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

## Verification History

- `2026-02-19T13-39-48Z`: eval `9/9`, enrich `9/9`, accept `PASS`, presubmit `PASS` (demo-account readiness recheck)
- `2026-02-10T19-27-44Z`: eval `9/9`, accept `PASS`, presubmit `PASS` (with tool annotation fix)
- `2026-02-09T11-53-41Z`: eval `9/9`, accept `PASS`, presubmit `PASS`
- `2026-02-08T22-48-28Z`: eval `9/9`, accept `PASS`, presubmit `PASS`
- `2026-02-08T22-39-03Z`: eval `9/9`, accept `PASS`, presubmit `PASS`
- `2026-02-08T20-37-44Z`: eval + enrich + accept + presubmit all `PASS`
