# TODO

## Bugs
- **Dev console chat localhost limitation**: MCP tools fail locally (424 error) because OpenAI can't reach localhost. Use preview URLs or Claude/ChatGPT desktop apps.
- **Node.js v25 localStorage warning (ignore)**: Running `npm run dev:frontend` on Node v25+ shows `Warning: --localstorage-file was provided without a valid path`. This is a [known Node.js v25 regression](https://github.com/nodejs/node/issues/60704) and is harmless. Suppressed via `NODE_OPTIONS='--no-webstorage'` in the dev script.
- **Leagues page horizontal resize**: Page doesn't resize correctly on narrow viewports.
- ~~**Homepage multi-platform clarity**: Box 2 ("Install Extension") needs to show both platforms~~ - Done: StepConnectPlatforms component (Jan 2025)

## Features
- **Deepen MCP functionality for football and baseball**: expand coverage (edge cases, richer data, pagination), and add more tests for existing tools.
  - Unified gateway tools (`workers/fantasy-mcp`): `get_user_session`, `get_league_info`, `get_standings`, `get_matchups`, `get_roster`, `get_free_agents`
  - Full feature parity between football and baseball (stats, projected points, free agents)
  - Legacy workers still available as fallback: `baseball-espn-mcp`, `football-espn-mcp`

## Marketing
- **Visual Proof**: Add interaction mockups/chat screenshots and use real platform logos.
- **Benefit-driven UX**: Add "What can you ask?" grid with high-value AI query examples.
- **Trust & Identity**: Add personal "indie developer" note and explicit security highlights.

## Maintenance & Refactoring
- **ESPN API Type Safety**: Replace `as any` type assertions in `espn-client` handlers with proper TypeScript interfaces. Create interfaces for the ESPN API response fields we actually use. See TODO in `workers/espn-client/src/types.ts`.
- **Codebase Audit & Streamlining**: Conduct a thorough review for legacy code, unused utilities, or redundant components. Identify parts of the system that are no longer in use (specifically around older auth patterns or defunct chat features) and remove them cautiously to reduce technical debt while ensuring no regressions.
- **Devconsole chat clarity**: Reduce excess tool verbosity when using the devconsole chat to keep responses concise.
- **Advanced Token & Usage Analytics**: Implement per-turn and per-session token usage tracking in the chat UI by capturing usage data from the Responses API stream. Include cost estimation and historical usage trends.
- **Reconcile remaining ESPN baseball mapping unknowns**: Validate slot IDs `18`/`22` per `workers/espn-client/src/sports/baseball/MAPPINGS.md`.

## Infrastructure & UX Polish
- **Dynamic preview URLs for OAuth**: Yahoo OAuth callback redirects to hardcoded `flaim-preview.vercel.app`. Should support dynamic Vercel preview URLs (e.g., pass preview URL in OAuth state, or use Vercel preview domain aliases). Currently can't test Yahoo OAuth on preview deployments.
- **Automated Testing**: Core OAuth/tool routing tests added; consider deeper integration tests when usage grows.
- **Service Monitoring**: Add external uptime checks for existing `/health` endpoints.
- **UX Polish**: Implement loading states (spinners or skeletons) across the web dashboard and extension to improve perceived performance during API fetches.

## Long-term Complexities to Simplify
- **Harden OAuth Implementation**: The custom OAuth 2.1 provider in `auth-worker` is complex. While keeping it is strategic (hard to replace with off-the-shelf serverless libs), it requires comprehensive integration tests to prevent security regressions.
- **Address Supabase security advisor warnings**: Review and resolve lint warnings from the Supabase dashboard security advisor.

## Long-term Potential Implementations
- Create iOS app (Significant undertaking/Major platform expansion)
- Automate connector additions via browser extension (might be too complex for now)
- Add hockey and basketball functionality with new workers
- Expand to additional fantasy platforms (Yahoo, Sleeper, etc.)

## Parked / Blocked
- **Claude Connector Directory listing**: Flaim is technically compliant with Anthropic's MCP directory requirements (OAuth 2.1, tool annotations, Streamable HTTP, etc.), but unlikely to be approved because Flaim doesn't control the endpoint domain—it proxies to ESPN's APIs. Anthropic's directory appears to favor connectors where the submitter owns/controls the data source. Revisit if policy changes or if ESPN ever offers an official partnership/API program. (Analysis: Jan 2026)
