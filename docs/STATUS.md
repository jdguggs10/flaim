# Current Project Status

Facts that should stay in sync with the codebase.

Last updated: 2026-02-09

## Current Delivery Phase

- Active phase: post-Sprint-B stabilization and submission preflight.
- Canonical execution tracker: `docs/dev/CURRENT-EXECUTION-STATE.md`.

## MCP Endpoints

- Primary endpoint: `https://api.flaim.app/mcp`
- Legacy alias: `https://api.flaim.app/fantasy/mcp`
- Transport note: MCP endpoint is POST-only for protocol calls (`GET` returns `405` with `Allow: POST`).

## Unified MCP Tools

All tools are read-only and use explicit parameters (`platform`, `sport`, `league_id`, `season_year`, plus optional fields where applicable).

| Tool | Description |
|---|---|
| `get_user_session` | User leagues across platforms with IDs |
| `get_ancient_history` | Historical leagues and seasons (2+ years old) |
| `get_league_info` | League settings and members |
| `get_roster` | Team roster with player stats |
| `get_matchups` | Current/specified week matchups |
| `get_standings` | League standings |
| `get_free_agents` | Available free agents |

## Platform/Sport Support

| Sport | ESPN | Yahoo | Notes |
|---|---|---|---|
| Football | ✅ | ✅ | Full read-tool coverage |
| Baseball | ✅ | ✅ | Full read-tool coverage |
| Basketball | ❌ | ❌ | Not implemented yet (`NOT_SUPPORTED`) |
| Hockey | ❌ | ❌ | Not implemented yet (`NOT_SUPPORTED`) |

## Worker Inventory

- `auth-worker`
- `fantasy-mcp` (gateway)
- `espn-client`
- `yahoo-client`

## Eval Observability

- Eval headers: `X-Flaim-Eval-Run`, `X-Flaim-Eval-Trace`
- Structured eval logs implemented across all 4 workers.
- Artifact layout is trace-scoped in `flaim-eval`.
- Acceptance tooling exists (`npm run accept`, `npm run presubmit`).
- Latest full eval run (`2026-02-09T11-53-41Z`) completed `9/9`, `0` errored.
- Latest acceptance + presubmit for that run are `PASS`.

## Current Blocking Gate

- Discovery/connectivity blocker is resolved (OpenAI MCP 424 issue fixed).
- No technical blockers remain for submission. Remaining work is operational: submit and respond to review feedback.

## Client Channel Readiness

| Channel | Status | Notes |
|---|---|---|
| Claude custom connector | Working | Token-lifecycle re-auth verified (claude.ai and Claude Code). |
| ChatGPT custom connector | Working | OAuth flow works; runbook exists |
| Gemini CLI direct MCP | Working (with CLI caveat) | Token-lifecycle re-auth is verified; Gemini CLI may emit intermittent internal rendering errors, but MCP tool calls succeed |
| Anthropic Connectors Directory | Pending | Packet drafted; submission decision pending |
| OpenAI Apps Directory | Pending | Packet drafted; screenshot evidence + preflight runs are complete; final submission timing pending |
| MCP Registry | Live | Published as `app.flaim/mcp` via `mcp-publisher` CLI with DNS verification |

## CI Deploy Targets

From `.github/workflows/deploy-workers.yml`:

- `auth-worker`
- `espn-client`
- `yahoo-client`
- `fantasy-mcp`

## Extension Version

- Chrome extension `manifest.json`: `1.5.0`
