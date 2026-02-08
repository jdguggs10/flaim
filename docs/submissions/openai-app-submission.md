# OpenAI App Submission Packet

Prepared for submission to the ChatGPT Apps Directory. Re-verify fields against the [submission guidelines](https://developers.openai.com/apps-sdk/deploy/submission/) and [app submission guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines) within 7 days before submitting.

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

## Content Security Policy

Flaim fetches data from the following domains:
- `https://api.flaim.app` — MCP server and OAuth endpoints
- `https://flaim.app` — Consent page and user dashboard

No external domains are contacted from the MCP server beyond ESPN and Yahoo APIs (server-side only, not client-facing).

## Test Instructions

For reviewers to test the integration:

1. **Create account:** Go to https://flaim.app → sign up (free)
2. **Add ESPN credentials:**
   - Install the [Flaim Chrome Extension](https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn)
   - Be signed in to ESPN in Chrome
   - Click the extension → Sync
   - Or: manually enter ESPN cookies (SWID, espn_s2) at flaim.app
3. **Verify setup:** Go to https://flaim.app/leagues — confirm leagues appear and a default is set
4. **Connect in ChatGPT:** Add Flaim as a custom action using MCP URL `https://api.flaim.app/mcp`
5. **Test prompts:**
   - "What fantasy leagues do I have?"
   - "Show me the standings in my league"
   - "Who is on my roster?"

### Expected Behavior

- `get_user_session` returns a list of the user's leagues with platform, sport, league ID, and season
- `get_standings` returns team rankings with win/loss records
- `get_roster` returns player names, positions, and recent stats

## Tools

All tools are annotated with `readOnlyHint: true`. No destructive or write operations.

| Tool | Description |
|------|-------------|
| `get_user_session` | User's leagues across all platforms with IDs |
| `get_ancient_history` | Historical leagues and seasons (2+ years old) |
| `get_league_info` | League settings and members |
| `get_standings` | League standings |
| `get_matchups` | Current/specified week matchups |
| `get_roster` | Team roster with player stats |
| `get_free_agents` | Available free agents |

## Screenshots

<!-- Capture during testing and replace with actual images -->

- [ ] OAuth consent flow (browser authorization page)
- [ ] ChatGPT showing `get_user_session` results
- [ ] ChatGPT showing standings data
- [ ] ChatGPT showing roster data

## Known Limitations

- **Platforms:** ESPN and Yahoo only (Sleeper, CBS, etc. not supported)
- **Sports:** Football and baseball (basketball and hockey planned)
- **ESPN credentials:** Session cookies expire ~30 days; user must re-sync
- **Yahoo tokens:** Auto-refresh via OAuth; occasional manual re-auth
- **Read-only:** No trades, adds, drops, or league modifications
- **Rate limit:** 200 MCP calls per day per user

## Safety & Privacy

- All tools are read-only with `readOnlyHint: true` annotation
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
