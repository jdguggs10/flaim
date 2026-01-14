# TODO

## Bugs
- Dev console chat app is failing to call the MCP tools successfully

## Features
- **Deepen MCP functionality for football and baseball**: expand coverage (edge cases, richer data, pagination), and add tests for existing tools.
  - Current football tools (workers/football-espn-mcp): `get_user_session`, `get_espn_football_league_info`, `get_espn_football_team`, `get_espn_football_matchups`, `get_espn_football_standings`.
  - Current baseball tools (workers/baseball-espn-mcp): `get_user_session`, `get_espn_baseball_league_info`, `get_espn_baseball_team_roster`, `get_espn_baseball_matchups`, `get_espn_baseball_standings`.

## Marketing
- **Visual Proof**: Add interaction mockups/chat screenshots and use real platform logos.
- **Benefit-driven UX**: Add "What can you ask?" grid with high-value AI query examples.
- **Trust & Identity**: Add personal "indie developer" note and explicit security highlights.

## Maintenance & Refactoring
- **Codebase Audit & Streamlining**: Conduct a thorough review for legacy code, unused utilities, or redundant components. Identify parts of the system that are no longer in use (specifically around older auth patterns or defunct chat features) and remove them cautiously to reduce technical debt while ensuring no regressions.
- **Advanced Token & Usage Analytics**: Implement per-turn and per-session token usage tracking in the chat UI by capturing usage data from the Responses API stream. Include cost estimation and historical usage trends.

## Infrastructure & UX Polish
- **Automated Testing**: Implement unit and integration tests for core API logic (Fan API, auth handlers) to prevent regressions.
- **Service Monitoring**: Add external uptime checks for existing `/health` endpoints.
- **UX Polish**: Implement loading states (spinners or skeletons) across the web dashboard and extension to improve perceived performance during API fetches.

## Long-term Complexities to Simplify
- **Adopt Official MCP SDK**: Replace manual JSON-RPC/MCP protocol handling in `workers/*/src/mcp/` with `@modelcontextprotocol/sdk` to reduce boilerplate (~100s of lines) and ensure spec compliance.
- **Standardize Worker Routing**: Replace manual `if (pathname === ...)` routing in workers with a lightweight router like `hono` or `itty-router` to simplify middleware (CORS, Auth) and route handling.
- **Harden OAuth Implementation**: The custom OAuth 2.1 provider in `auth-worker` is complex. While keeping it is strategic (hard to replace with off-the-shelf serverless libs), it requires comprehensive integration tests to prevent security regressions.

## Long-term Potential Implementations
- Create iOS app (Significant undertaking/Major platform expansion)
- Automate connector additions via browser extension (might be too complex for now)
- Add hockey and basketball functionality with new workers
- Expand to additional fantasy platforms (Yahoo, Sleeper, etc.)
