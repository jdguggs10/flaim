# Flaim - Fantasy League AI Connector

Flaim connects your ESPN fantasy leagues to AI assistants like Claude and ChatGPT. It's an MCP (Model Context Protocol) service that gives AI tools access to your live fantasy data.

## How It Works

1. **Create a Clerk account & sign in** — This is where your ESPN credentials and league info are stored
2. **Sync ESPN credentials** — Install the [Chrome extension](https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn) to sync automatically, or enter them manually
3. **Leagues auto-discovered** — Extension finds all your leagues + past seasons and saves them
4. **Pick a default** — Select which league to use by default in AI conversations
5. **Connect your AI** — Add Flaim as a custom MCP connector in Claude/ChatGPT using the MCP URLs
6. **Use MCP tools** — Ask about your roster, matchups, standings directly in your AI

Bring your own Claude or ChatGPT subscription. Flaim provides the data bridge.

## Automation vs Manual (Quick Clarification)

- **Extension (automatic)**: Runs only when the user clicks **Sync / Re-sync**. It discovers leagues + past seasons and can set a default.
- **Site (manual)**: `/leagues` is independent. Users can add leagues by ID and manually trigger season discovery.

## What Flaim Is

Flaim is an **authentication and data service** for fantasy sports AI integrations:

- **MCP Server**: Exposes fantasy league data to Claude and ChatGPT via the Model Context Protocol
- **OAuth Provider**: Handles secure authentication between AI clients and your ESPN data
- **Credential Manager**: Securely stores and manages ESPN session cookies

Flaim is **not** a chatbot or AI product itself — it's the bridge that lets you use your preferred AI tool with your fantasy data.

## Features

- **Chrome Extension**: Auto-capture ESPN credentials without manual cookie extraction
- **Auto-Discovery (v1.2.1)**: Fan API-based discovery of leagues + past seasons, with granular status messaging and default selection
- **Claude + ChatGPT OAuth**: Direct access via MCP protocol (OAuth 2.1)
- **Live ESPN Data**: Baseball and football MCP workers with real-time stats
- **Multi-League + Multi-Season Support**: Store multiple seasons per league and discover past seasons

## About

Flaim is a solo indie project — built with care, maintained for the long term. The focus is on reliability, security, and doing one thing well. No VC funding, no growth pressure, just a useful tool for fantasy sports fans who use AI.

## Season Years

Season year defaults are deterministic and use America/New_York time:

- **Baseball (flb)**: Defaults to the previous year until Feb 1, then switches to the current year
- **Football (ffl)**: Defaults to the previous year until Jun 1, then switches to the current year

## MCP Tools

| Tool | Sport | Description |
|------|-------|-------------|
| `get_user_session` | Both | User's leagues, teams, seasons, default league |
| `get_espn_baseball_league_info` | Baseball | League settings and members |
| `get_espn_baseball_team_roster` | Baseball | Team roster with stats |
| `get_espn_baseball_matchups` | Baseball | Current/upcoming matchups |
| `get_espn_baseball_standings` | Baseball | League standings |
| `get_espn_baseball_free_agents` | Baseball | Available free agents |
| `get_espn_baseball_box_scores` | Baseball | Box scores for games |
| `get_espn_baseball_recent_activity` | Baseball | Recent league activity (trades, adds, drops) |
| `get_espn_football_league_info` | Football | League settings and members |
| `get_espn_football_team` | Football | Team roster with stats |
| `get_espn_football_matchups` | Football | Current/upcoming matchups |
| `get_espn_football_standings` | Football | League standings |

## Architecture

```
Chrome Extension → flaim.app → Auth Worker → Supabase
                      ↓
Claude/ChatGPT → MCP Workers → ESPN API
```

- **Chrome Extension**: Captures ESPN cookies, syncs to Flaim
- **Web App (Next.js)**: User dashboard, OAuth endpoints, league management
- **Auth Worker (Cloudflare)**: Token validation, rate limiting, credential storage
- **MCP Workers (Cloudflare)**: Baseball and football data fetchers
- **Supabase**: User data, OAuth tokens, ESPN credentials

---

## For Contributors

Solo developer, hobby project. Keep it simple and stable.

- **Small changes** — 1-2 hour tasks, one new concept at a time
- **Boring tech** — Stick to the stack (Next.js, Vercel, Clerk, Cloudflare, Supabase)
- **Official docs first** — Copy from examples before inventing patterns

### Documentation

| Document | Description |
|----------|-------------|
| [Architecture](ARCHITECTURE.md) | System design, deployment, troubleshooting |
| [Changelog](CHANGELOG.md) | Release history |
| [Web App](../web/README.md) | Next.js routes, components, environment |
| [Workers](../workers/README.md) | Cloudflare Workers, MCP tools, ESPN API |
| [Extension](../extension/README.md) | Chrome extension build, Sync Host, CWS |

### Quick Start (Development)

```bash
git clone https://github.com/jdguggs10/flaim.git
cd flaim && npm install
cp web/.env.example web/.env.local  # add keys
npm run dev
```

---

## Getting Help

This is a solo indie project with best-effort support. I'll do my best to respond, but it may take time.

- Issues: [GitHub Issues](https://github.com/jdguggs10/flaim/issues)
- Discussions: [GitHub Discussions](https://github.com/jdguggs10/flaim/discussions)

## License

MIT License - see [LICENSE](../LICENSE).
