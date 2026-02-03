# TODO

## Bugs


## Features
- Deepen MCP functionality for football and baseball: expand coverage (edge cases, richer data, pagination), and add more tests for existing tools.

## Marketing
- Visual Proof: Add interaction mockups/chat screenshots and use real platform logos.
- Benefit-driven UX: Add "What can you ask?" grid with high-value AI query examples.
- Email Support Upgrade: Upgrade cloudflare email functionality

## Maintenance & Refactoring
- **Tailwind v3 → v4**: Migrate from Tailwind 3.4 to v4 (CSS-first config, no more `tailwind.config.js`). Non-urgent — v3 works fine, but v4 is faster and the future direction.
- Advanced Token & Usage Analytics: Implement per-turn and per-session token usage tracking in the chat UI by capturing usage data from the Responses API stream. Include cost estimation and historical usage trends.


## Infrastructure & UX Polish
- Dynamic preview URLs for OAuth: Yahoo OAuth callback redirects to hardcoded `flaim-preview.vercel.app`. Should support dynamic Vercel preview URLs (e.g., pass preview URL in OAuth state, or use Vercel preview domain aliases). Currently can't test Yahoo OAuth on preview deployments.
- Automated Testing: Core OAuth/tool routing tests added; consider deeper integration tests when usage grows.
- Service Monitoring: Add external uptime checks for existing `/health` endpoints.

## Long-term Potential Implementations
- Create iOS app (Significant undertaking/Major platform expansion)
- Automate connector additions via browser extension (might be too complex for now)
- Add basketball and hockey support: Implement handlers for basketball and hockey in both `espn-client` and `yahoo-client` workers (5 tools each: get_league_info, get_standings, get_roster, get_matchups, get_free_agents)
- Expand to additional fantasy platforms: Add Sleeper, CBS Sports, or other platforms (each platform = new `{platform}-client` worker + service binding + OAuth routes)

## Parked / Blocked
- Claude Connector Directory listing: Flaim is technically compliant with Anthropic's MCP directory requirements (OAuth 2.1, tool annotations, Streamable HTTP, etc.), but unlikely to be approved because Flaim doesn't control the endpoint domain—it proxies to ESPN's APIs. Anthropic's directory appears to favor connectors where the submitter owns/controls the data source. Revisit if policy changes or if ESPN ever offers an official partnership/API program. (Analysis: Jan 2026)
