# TODO

## Bugs
- **Dev console chat localhost limitation**: MCP tools fail locally (424 error) because OpenAI can't reach localhost. Use preview URLs or Claude/ChatGPT desktop apps.
- **Node.js v25 localStorage warning (ignore)**: Running `npm run dev:frontend` on Node v25+ shows `Warning: --localstorage-file was provided without a valid path`. This is a [known Node.js v25 regression](https://github.com/nodejs/node/issues/60704) and is harmless. Suppressed via `NODE_OPTIONS='--no-webstorage'` in the dev script.

## Features
- **Deepen MCP functionality for football and baseball**: expand coverage (edge cases, richer data, pagination), and add tests for existing tools.
  - Current football tools (workers/football-espn-mcp): `get_user_session`, `get_espn_football_league_info`, `get_espn_football_team`, `get_espn_football_matchups`, `get_espn_football_standings`.
  - Current baseball tools (workers/baseball-espn-mcp): `get_user_session`, `get_espn_baseball_league_info`, `get_espn_baseball_team_roster`, `get_espn_baseball_matchups`, `get_espn_baseball_standings`, `get_espn_baseball_free_agents`, `get_espn_baseball_box_scores`, `get_espn_baseball_recent_activity`.

## Marketing
- **Visual Proof**: Add interaction mockups/chat screenshots and use real platform logos.
- **Benefit-driven UX**: Add "What can you ask?" grid with high-value AI query examples.
- **Trust & Identity**: Add personal "indie developer" note and explicit security highlights.

## Maintenance & Refactoring
- **Codebase Audit & Streamlining**: Conduct a thorough review for legacy code, unused utilities, or redundant components. Identify parts of the system that are no longer in use (specifically around older auth patterns or defunct chat features) and remove them cautiously to reduce technical debt while ensuring no regressions.
- **Devconsole chat clarity**: Reduce excess tool verbosity when using the devconsole chat to keep responses concise.
- **Advanced Token & Usage Analytics**: Implement per-turn and per-session token usage tracking in the chat UI by capturing usage data from the Responses API stream. Include cost estimation and historical usage trends.

## Infrastructure & UX Polish
- **Automated Testing**: Implement unit and integration tests for core API logic (Fan API, auth handlers) to prevent regressions.
- **Service Monitoring**: Add external uptime checks for existing `/health` endpoints.
- **UX Polish**: Implement loading states (spinners or skeletons) across the web dashboard and extension to improve perceived performance during API fetches.

## Long-term Complexities to Simplify
- **Worker Infrastructure Migration (Hono + MCP SDK)**: Adopt Hono for routing and the official MCP SDK for protocol handling. See [MCP_SDK_HONO_MIGRATION_PLAN.md](./MCP_SDK_HONO_MIGRATION_PLAN.md) for the unified plan. Status: Good fit, low urgency.
- **Harden OAuth Implementation**: The custom OAuth 2.1 provider in `auth-worker` is complex. While keeping it is strategic (hard to replace with off-the-shelf serverless libs), it requires comprehensive integration tests to prevent security regressions.

## Long-term Potential Implementations
- Create iOS app (Significant undertaking/Major platform expansion)
- Automate connector additions via browser extension (might be too complex for now)
- Add hockey and basketball functionality with new workers
- Expand to additional fantasy platforms (Yahoo, Sleeper, etc.)
