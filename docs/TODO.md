# TODO

## Bugs
- 

## Features
- Automate connector additions via browser extension.
- **Deepen MCP functionality for football and baseball**: expand coverage (edge cases, richer data, pagination), and add tests for existing tools.
  - Current football tools (workers/football-espn-mcp): `get_user_session`, `get_espn_football_league_info`, `get_espn_football_team`, `get_espn_football_matchups`, `get_espn_football_standings`.
  - Current baseball tools (workers/baseball-espn-mcp): `get_user_session`, `get_espn_baseball_league_info`, `get_espn_baseball_team_roster`, `get_espn_baseball_matchups`, `get_espn_baseball_standings`.

## Marketing
- Clean up site marketing copy.
- **Visual Proof**: Add interaction mockups/chat screenshots and use real platform logos.
- **Benefit-driven UX**: Add "What can you ask?" grid with high-value AI query examples.
- **Trust & Identity**: Add personal "indie developer" note and explicit security highlights.

## Maintenance & Refactoring
- **Codebase Audit & Streamlining**: Conduct a thorough review for legacy code, unused utilities, or redundant components. Identify parts of the system that are no longer in use (specifically around older auth patterns or defunct chat features) and remove them cautiously to reduce technical debt while ensuring no regressions.

## Infrastructure & UX Polish
- **Automated Testing**: Implement unit and integration tests for core API logic (Fan API, auth handlers) to prevent regressions.
- **Service Monitoring**: Add external uptime checks for existing `/health` endpoints.
- **UX Polish**: Implement loading states (spinners or skeletons) across the web dashboard and extension to improve perceived performance during API fetches.
  - Header/nav: active-tab pills + icons for primary pages (Leagues / Connectors / Extension).
  - Header/nav: mobile hamburger menu (Dialog) that consolidates nav + account.
  - Header/account: richer “Account” menu via Popover (custom) vs Clerk `UserButton` (keep as-is).

## Long-term Potential Implementations
- Create iOS app (Significant undertaking/Major platform expansion)
- Comprehensive Developer Chat UI Refresh (flaim.app/chat): Overhaul the developer-facing chat interface with improved debugging visualization, enhanced layout, and premium aesthetics.
  - Advanced Token & Usage Analytics: Implement per-turn and per-session token usage tracking in the chat UI by capturing usage data from the Responses API stream. Include cost estimation and historical usage trends.
- Add hockey and basketball functionality with new workers
- Expand to additional fantasy platforms (Yahoo, Sleeper, etc.)
