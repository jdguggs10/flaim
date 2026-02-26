# Current Project Status

Facts that should stay in sync with the codebase.

Last updated: 2026-02-24

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
| `get_transactions` | Recent transactions (adds, drops, waivers, trades) |

`get_transactions` semantics in v1 are platform-specific:
- ESPN and Sleeper support explicit week filtering and default to current+previous week when `week` is omitted.
- Yahoo ignores explicit `week`, uses a recent 14-day timestamp window, and does not support `type=waiver` filtering in v1.

## Platform/Sport Support

| Sport | ESPN | Yahoo | Sleeper | Notes |
|---|---|---|---|---|
| Football | ✅ | ✅ | ✅ | Full read-tool coverage |
| Baseball | ✅ | ✅ | — | Full read-tool coverage (ESPN/Yahoo); Sleeper does not support baseball |
| Basketball | ✅ | ✅ | ✅ | Full read-tool coverage (ESPN mappings unverified — no live credentials yet) |
| Hockey | ✅ | ✅ | — | Full read-tool coverage (ESPN mappings unverified — no live credentials yet); Sleeper does not support hockey |

Sleeper tool coverage (Phase 1): `get_league_info`, `get_standings`, `get_roster`, `get_matchups`, `get_transactions` for NFL (football) and NBA (basketball). No `get_free_agents` — Sleeper does not expose a free agent endpoint in Phase 1. Standings are computed from roster settings (no dedicated Sleeper standings endpoint).

## Worker Inventory

- `auth-worker`
- `fantasy-mcp` (gateway)
- `espn-client`
- `yahoo-client`
- `sleeper-client`

## Eval Observability

- Eval headers: `X-Flaim-Eval-Run`, `X-Flaim-Eval-Trace`
- Structured eval logs implemented across all 5 workers.
- Artifact layout is trace-scoped in `flaim-eval`.
- Acceptance tooling exists (`npm run accept`, `npm run presubmit`).
- All MCP tools have complete annotation set (`readOnlyHint`, `openWorldHint`, `destructiveHint`).
- All MCP tools have OpenAI `toolInvocation` status metadata (`invoking`/`invoked` messages).

## Current Blocking Gate

- Discovery/connectivity blocker is resolved (OpenAI MCP 424 issue fixed).
- No technical blockers remain for submission.
- Domain verification route (`/.well-known/openai-apps-challenge`) deployed; token set via `wrangler secret put` during submission.
- Demo reviewer account configured with password auth for reviewer access (credentials handled out-of-repo).

## Client Channel Readiness

| Channel | Status | Notes |
|---|---|---|
| Claude custom connector | Working | Token-lifecycle re-auth verified (claude.ai and Claude Code). |
| ChatGPT custom connector | Working | OAuth flow works; runbook exists |
| Gemini CLI direct MCP | Working (with CLI caveat) | Token-lifecycle re-auth is verified; Gemini CLI may emit intermittent internal rendering errors, but MCP tool calls succeed |
| Anthropic Connectors Directory | Pending | Packet drafted; submission decision pending |
| OpenAI Apps Directory | Ready to submit | Individual verification approved; demo reviewer account configured; domain verification route deployed; all requirements met |
| MCP Registry | Live | Published as `app.flaim/mcp` via `mcp-publisher` CLI with DNS verification |
| Gemini CLI Extensions Gallery | Pending | `gemini-extension.json` committed; auto-indexes within ~1 week |
| Glama | Pending review | Submitted via GitHub; [glama.ai/mcp/servers/@jdguggs10/flaim](https://glama.ai/mcp/servers/@jdguggs10/flaim) |
| MCP.so | Pending review | Submitted with description, tags, server config |
| awesome-mcp-servers | PR open | [PR #1918](https://github.com/punkpeye/awesome-mcp-servers/pull/1918) |
| PulseMCP | Auto-indexing | Ingests official registry daily; should appear within ~1 week |

## CI Deploy Targets

From `.github/workflows/deploy-workers.yml`:

- `auth-worker`
- `espn-client`
- `yahoo-client`
- `sleeper-client`
- `fantasy-mcp`

## Extension Version

- Chrome extension `manifest.json`: `1.5.1`
