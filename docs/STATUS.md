# Current Project Status

Facts that should stay in sync with the codebase. This is the source of truth for tools, parity, and deploy targets.

**Last updated:** 2026-01-29

## MCP Endpoints (current)
- Unified gateway (primary): `https://api.flaim.app/fantasy/mcp`
- Legacy endpoints (still functional): `https://api.flaim.app/football/mcp`, `https://api.flaim.app/baseball/mcp`

## Unified MCP Tools
All tools take explicit parameters: `platform`, `sport`, `league_id`, `season_year` (plus optional fields like `team_id`, `week`, `position`, `count`).

| Tool | Description |
|---|---|
| `get_user_session` | User's leagues across all platforms with IDs |
| `get_ancient_history` | Historical leagues and seasons (2+ years old) |
| `get_league_info` | League settings and members |
| `get_roster` | Team roster with player stats |
| `get_matchups` | Current/specified week matchups |
| `get_standings` | League standings |
| `get_free_agents` | Available free agents (platform/sport dependent) |

## Feature Parity Matrix (by platform/sport)

| Tool | ESPN Football | ESPN Baseball | Yahoo Football | Yahoo Baseball |
|------|:-------------:|:-------------:|:--------------:|:--------------:|
| `get_user_session` | ✅ | ✅ | ✅ | ✅ |
| `get_ancient_history` | ✅ | ✅ | ✅ | ✅ |
| `get_league_info` | ✅ | ✅ | ✅ | ✅ |
| `get_standings` | ✅ | ✅ | ✅ | ✅ |
| `get_matchups` | ✅ | ✅ | ✅ | ✅ |
| `get_roster` | ✅ | ✅ | ✅ | ✅ |
| `get_free_agents` | ✅ | ✅ | ✅ | ✅ |

**Legend:** ✅ Implemented | ❌ Not implemented | — Not applicable

## Workers (repo inventory)
- `auth-worker`
- `fantasy-mcp` (gateway)
- `espn-client`
- `yahoo-client`
- `baseball-espn-mcp` (legacy)
- `football-espn-mcp` (legacy)

## CI Deploy Targets (from `.github/workflows/deploy-workers.yml`)
- `auth-worker`
- `baseball-espn-mcp`
- `football-espn-mcp`
- `espn-client`
- `fantasy-mcp`

## Extension Version
- Chrome extension `manifest.json`: `1.4.0`

