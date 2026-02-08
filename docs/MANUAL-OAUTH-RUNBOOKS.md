# Manual OAuth Connect Runbooks

Run these checklists manually before each directory submission or after auth changes. Each section covers a fresh connect, tool verification, and token lifecycle for one client.

**MCP URL:** `https://api.flaim.app/mcp`
**OAuth endpoints:** `/auth/authorize`, `/auth/token`, `/auth/revoke`
**Consent page:** `https://flaim.app/oauth/consent`

---

## Claude Desktop / claude.ai

### Fresh connect
- [ ] Open Claude Desktop settings (or claude.ai MCP settings)
- [ ] Add remote MCP server → URL: `https://api.flaim.app/mcp`
- [ ] Claude triggers OAuth → browser opens Flaim consent page
- [ ] Approve access → redirect back to Claude
- [ ] Confirm: Claude shows Flaim tools available

### Verify tools
- [ ] Ask: "What leagues do I have?" → `get_user_session` returns league list
- [ ] Ask: "Show me the standings" → `get_standings` returns standings for default league
- [ ] Ask: "Who is on my roster?" → `get_roster` returns roster data
- [ ] Confirm: all responses contain real league data (not errors)

### Token lifecycle
- [ ] Wait for token expiry (or revoke token via Supabase `oauth_tokens` table)
- [ ] Ask a question → should trigger 401 → Claude re-initiates OAuth
- [ ] Re-authorize → confirm tools work again
- [ ] Success: full connect → expire → reconnect cycle works

---

## ChatGPT

### Fresh connect
- [ ] Go to ChatGPT → Explore GPTs → Create (or edit existing)
- [ ] Add Action → import from URL: `https://api.flaim.app/mcp`
- [ ] Configure OAuth: Auth URL `https://api.flaim.app/auth/authorize`, Token URL `https://api.flaim.app/auth/token`
- [ ] Save → start conversation → ChatGPT triggers OAuth
- [ ] Browser opens Flaim consent page → approve → redirect back
- [ ] Confirm: ChatGPT shows "Connected" status

### Verify tools
- [ ] Ask: "What leagues do I have?" → `get_user_session` returns league list
- [ ] Ask: "Show me the standings for my league" → `get_standings` returns data
- [ ] Ask: "Who is on my roster?" → `get_roster` returns roster
- [ ] Confirm: all responses contain real league data (not errors)

### Token lifecycle
- [ ] Wait for token expiry (or revoke via Supabase)
- [ ] Ask a question → observe re-auth behavior
- [ ] Re-authorize if prompted → confirm tools work again
- [ ] Success: full connect → expire → reconnect cycle works

---

## Gemini CLI

### Fresh connect
- [ ] Run: `gemini mcp add flaim --url https://api.flaim.app/mcp`
- [ ] Gemini CLI triggers OAuth → browser opens Flaim consent page
- [ ] Approve access → redirect back
- [ ] Confirm: `gemini mcp list` shows flaim as connected

### Verify tools
- [ ] Ask: "What leagues do I have?" → `get_user_session` returns league list
- [ ] Ask: "Show me my league standings" → `get_standings` returns data
- [ ] Ask: "Who is on my roster?" → `get_roster` returns roster
- [ ] Confirm: all responses contain real league data (not errors)

### Token lifecycle
- [ ] Wait for token expiry (or force by revoking in Supabase)
- [ ] Re-run a query → Gemini CLI should auto-refresh the token
- [ ] If auto-refresh fails: `gemini mcp remove flaim` → re-add → re-authorize
- [ ] Confirm tools work after re-auth
- [ ] Success: full connect → expire → refresh/reconnect cycle works

---

## What success looks like

For each client:
1. OAuth consent flow completes without errors
2. All three tool calls (`get_user_session`, `get_standings`, `get_roster`) return real data
3. Token expiry triggers re-auth (or auto-refresh for Gemini CLI)
4. Post-re-auth tools work identically to fresh connect

## Verification gates

### Preview gate (before merging to main)

Run against preview environment (PR deploy):

1. `npm run eval` in flaim-eval — all scenarios complete without errors
2. `npm run accept -- <run_id>` — acceptance passes
3. `npm run presubmit -- <run_id>` — prints PASS
4. Per-worker unit tests pass (all 4 workers)
5. `npm run lint` — no errors

### Production smoke (after merge to main)

Run against production after auto-deploy completes:

1. `curl https://api.flaim.app/auth/health` — returns 200
2. Quick manual check: connect one client, call `get_user_session` → returns real data
3. `npm run eval` in flaim-eval (targets production by default) — spot-check 1-2 scenarios
4. If auth changes: run full OAuth runbook for the affected client(s)

## When to run

- **Preview gate:** Every PR that touches workers, auth, or tool contracts
- **Production smoke:** After every merge to main that touches workers
- **Full manual runbook:** Before each directory submission (Anthropic, OpenAI)
- **Full manual runbook:** After any auth-worker changes that touch OAuth flows
- **Full manual runbook:** After any changes to redirect URI validation or token handling
