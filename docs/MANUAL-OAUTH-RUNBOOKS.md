# Manual OAuth Connect Runbooks (Slim)

This is a lightweight checklist for re-verifying OAuth + MCP connectivity in each client before submission, or after auth changes.

**MCP URL:** `https://api.flaim.app/mcp`  
**Consent page:** `https://flaim.app/oauth/consent`

## Current Status (Last Verified: 2026-02-19)

| Client | Fresh connect | Tools (`get_user_session`, `get_standings`, `get_roster`) | Token lifecycle | Evidence |
|---|---|---|---|---|
| ChatGPT | ✅ | ✅ | ✅ (forced revoke + re-auth) | `../submissions/openai-screenshots/` (private workspace folder) |
| Claude (claude.ai) | ✅ | ✅ | ✅ (post-revoke re-auth) | (see notes in `docs/dev/CURRENT-EXECUTION-STATE.md`) |
| Claude Code (CLI) | ✅ | ✅ | ✅ (post-revoke re-auth via `/mcp`) | (terminal transcript) |
| Gemini CLI | ✅ | ✅ | ✅ (post-revoke re-auth via `/mcp auth`) | (terminal transcript; CLI may emit internal rendering errors) |

## Minimal Checklist (Per Client)

1. **Fresh connect**
   - Add MCP server: `https://api.flaim.app/mcp`
   - Approve OAuth consent
2. **Verify tools** (must return real data)
   - `get_user_session`
   - `get_standings` (default league)
   - `get_roster` (default league)
3. **Token lifecycle**
   - Force token invalidation (preferred): `POST /api/oauth/revoke-all` from an authenticated `flaim.app` session
   - Confirm next tool call fails with an auth-required message
   - Re-auth in the client and confirm tools succeed again

## Notes

- Cross-client revocation (`POST /api/oauth/revoke-all`) revokes *all* AI-client tokens for the user; expect every client to require re-auth after running it.
- Gemini CLI caveat: MCP tool calls can succeed even if Gemini emits intermittent internal UI/rendering errors.
