# Feature Parity Matrix

This document tracks implementation status of MCP tools across platforms and sports.

**Last updated:** 2026-01-29

## Tool Implementation Status

The unified gateway (`fantasy-mcp`) exposes all tools. Platform workers implement handlers per sport.

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

## Phase Roadmap

### Complete
- **Phase 0**: Gateway scaffolding (ESPN migration)
- **Phase 1**: Yahoo OAuth + league discovery
- **Phase 2**: Yahoo Football (5/5 tools) ✅
- **Phase 3**: Yahoo Baseball (5/5 tools) ✅

### Planned
- **Phase 4**: Additional sports (Basketball, Hockey)
- **Phase 5**: Additional platforms (CBS, Sleeper)

## Implementation Checklist

### Yahoo Football (Phase 2) — 5/5 Complete ✅
- [x] `get_league_info`
- [x] `get_standings`
- [x] `get_matchups`
- [x] `get_roster`
- [x] `get_free_agents`

### Yahoo Baseball (Phase 3) — 5/5 Complete ✅
- [x] `get_league_info`
- [x] `get_standings`
- [x] `get_matchups`
- [x] `get_roster`
- [x] `get_free_agents`

## Architecture

```
fantasy-mcp (gateway)
├── get_user_session     → auth-worker (internal)
├── get_ancient_history  → auth-worker (internal)
├── get_league_info      → platform-client → Platform API
├── get_standings        → platform-client → Platform API
├── get_matchups         → platform-client → Platform API
├── get_roster           → platform-client → Platform API
└── get_free_agents      → platform-client → Platform API

Platform clients:
├── espn-client/sports/football/handlers.ts  (5/5 tools)
├── espn-client/sports/baseball/handlers.ts  (5/5 tools)
├── yahoo-client/sports/football/handlers.ts (5/5 tools)
└── yahoo-client/sports/baseball/handlers.ts (5/5 tools)
```

## Adding a New Tool

1. Add tool definition to `fantasy-mcp/src/mcp/tools.ts`
2. Gateway routes to platform client via `routeToClient()`
3. Each platform client needs handler in `sports/{sport}/handlers.ts`
4. Update this matrix when complete

## Adding a New Sport

1. Create `sports/{sport}/handlers.ts` in platform client
2. Create `sports/{sport}/mappings.ts` for position/team mappings
3. Add sport case to `routeToSport()` in platform client index
4. Update this matrix when complete

## Adding a New Platform

1. Create `{platform}-client` worker with sport handlers
2. Add `/connect/{platform}/*` routes to auth-worker
3. Create `{platform}_credentials` and `{platform}_leagues` tables
4. Add service binding to `fantasy-mcp/wrangler.jsonc`
5. Update `get_user_session` to include new platform
6. Update this matrix when complete
