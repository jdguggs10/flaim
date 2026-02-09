# Anthropic Connector Submission Packet

Prepared for submission to the Anthropic Connectors Directory.

## Pre-submission verification checklist

Before submitting, re-verify this packet against official sources (policies change):

- [x] [Submission guide](https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide) — confirm required fields match
- [x] [Build guide](https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers) — confirm auth/transport requirements
- [x] [Connectors directory FAQ](https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq) — confirm review process hasn't changed
- [x] [MCP connector docs](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) — confirm API-level requirements
- [x] Run manual OAuth runbook for Claude (see `docs/MANUAL-OAUTH-RUNBOOKS.md`)
- [x] Run `npm run presubmit -- <run_id>` and confirm PASS (`2026-02-09T11-53-41Z`)

**Last verified against official sources:** 2026-02-09 (revalidated based on prior verification on 2026-02-07; proceed unless Anthropic guidance has changed)

---

## App Details

- **App name:** Flaim — Fantasy League AI Connector
- **Description:** Connect your ESPN and Yahoo fantasy sports leagues to Claude. Get standings, rosters, matchups, free agents, and league info via natural conversation. Read-only access — Flaim never modifies your league data.
- **MCP server URL:** `https://api.flaim.app/mcp`
- **Transport:** Streamable HTTP over `POST https://api.flaim.app/mcp` (non-POST requests return `405` with `Allow: POST`)

## Links

- **Privacy policy:** https://flaim.app/privacy
- **Support contact:** privacy@flaim.app
- **Website:** https://flaim.app
- **Source (if relevant):** https://github.com/jdguggs10/flaim
- **Connector docs (setup + examples):** `docs/CONNECTOR-DOCS.md`
- **Documentation URL (for submission form):** https://github.com/jdguggs10/flaim/blob/main/docs/CONNECTOR-DOCS.md

## Authentication

- **Auth type:** OAuth 2.1 with PKCE (S256)
- **Discovery:** `https://api.flaim.app/.well-known/oauth-authorization-server`
- **Protected resource metadata:** `https://api.flaim.app/.well-known/oauth-protected-resource`
- **Dynamic client registration:** `https://api.flaim.app/auth/register`
- **Authorization URL:** `https://api.flaim.app/auth/authorize`
- **Token URL:** `https://api.flaim.app/auth/token`
- **Revocation URL:** `https://api.flaim.app/auth/revoke`
- **Consent page:** `https://flaim.app/oauth/consent`
- **Scopes:** `mcp:read` (read-only fantasy data access)
- **Redirect URIs:** Configured for Claude Desktop (`http://localhost:*`) and claude.ai callbacks

## Test Account

To test Flaim during review:

1. Go to https://flaim.app and create a free account (Clerk sign-up)
2. Connect ESPN credentials using the Chrome extension or manual entry:
   - Install: [Flaim Chrome Extension](https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn)
   - Sign in to ESPN in Chrome → click extension → Sync
3. Verify leagues appear at https://flaim.app/leagues
4. Set a default league
5. Add MCP server in Claude: `https://api.flaim.app/mcp`

**Note:** ESPN credentials (cookies) expire approximately every 30 days and need re-syncing. Yahoo uses OAuth tokens that auto-refresh.

## Usage Examples (Slim)

Full examples are in `docs/CONNECTOR-DOCS.md`. Three prompts that should work for review:

1. "What fantasy leagues do I have?"
2. "Show me the standings in my default league."
3. "Who is on my roster in my default league?"

## Safety Notes

- **Read-only access**: All tools are read-only. No trades, adds, drops, or any write operations.
- **No PII beyond league data**: Flaim accesses fantasy league data (team names, player stats, standings). No personal information is collected beyond what's needed for authentication.
- **Rate limited**: 200 MCP calls per day per user.
- **Credential isolation**: ESPN/Yahoo credentials are stored encrypted in Supabase. Per-user isolation via verified JWT subject claims.
- **No third-party data sharing**: Data flows only between the user's AI client and Flaim's servers.

## Known Limitations

- **Supported platforms:** ESPN and Yahoo only (Sleeper, CBS, etc. not supported)
- **Supported sports:** Football and baseball (basketball and hockey planned)
- **ESPN credentials:** Session cookies expire ~30 days; user must re-sync via extension
- **Yahoo tokens:** OAuth refresh tokens handle auto-renewal
- **No write operations:** Cannot make trades, add/drop players, or modify league settings
- **Rate limit:** 200 calls/day per user

## Production Status

- **Status:** General availability (soft launch)
- **Uptime:** Cloudflare Workers (global edge deployment)
- **TLS:** Valid certificates on all endpoints
