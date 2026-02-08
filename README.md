# Flaim - Fantasy League AI Connector

Doc routing: see `docs/INDEX.md`.

Flaim connects your ESPN fantasy leagues to AI assistants like Claude, ChatGPT, and Gemini CLI. It's an MCP (Model Context Protocol) service that gives AI tools access to your live fantasy data.

## How It Works

1. **Create a Clerk account & sign in** — This is where your ESPN credentials and league info are stored
2. **Sync ESPN credentials** — Install the [Chrome extension](https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn) to sync automatically, or enter them manually
3. **Leagues auto-discovered** — Extension finds all your leagues + past seasons and saves them
4. **Pick a default** — Select which league to use by default in AI conversations
5. **Connect your AI** — Add Flaim as a custom MCP connector in Claude, ChatGPT, or Gemini CLI using the MCP URL
6. **Use MCP tools** — Ask about your roster, matchups, standings, etc. directly in your AI

Bring your own LLM subscription. Flaim provides the data bridge.

## Automation vs Manual (Quick Clarification)

- **Extension (automatic)**: Auto-pulls ESPN s2/swid and saves to supabase. Runs only when the user clicks **Sync / Re-sync**. It discovers leagues + past seasons and can set a default.
- **Site (manual)**: `/leagues` is independent. Users can add leagues by ID and manually trigger season discovery.

## What Flaim Is

Flaim is an **authentication and data service** for fantasy sports AI integrations:

- **MCP Server**: Exposes fantasy league data to Claude and ChatGPT via the Model Context Protocol
- **OAuth Provider**: Handles secure authentication between AI clients and your ESPN data
- **Credential Manager**: Securely stores and manages ESPN session cookies

Flaim is **not** a chatbot or AI product itself — it's the bridge that lets you use your preferred AI tool with your fantasy data.

## Features

- **Chrome Extension (v1.5.0)**: Auto-capture ESPN credentials without manual cookie extraction
- **Auto-Discovery (v1.2.1+)**: Fan API-based discovery of leagues + past seasons, with granular status messaging and default selection
- **Claude + ChatGPT + Gemini CLI**: Direct access via MCP protocol (OAuth 2.1)
- **Live ESPN Data**: espn-client worker with real-time stats
- **Multi-League + Multi-Season Support**: Store multiple seasons per league and discover past seasons

## About

Flaim is a solo indie project — built with care, maintained for the long term. The focus is on reliability, security, and doing one thing well. No VC funding, no growth pressure, just a useful tool for fantasy sports fans who use AI.

## Season Years

Season year defaults are deterministic and use America/New_York time:

- **Baseball (flb)**: Defaults to the previous year until Feb 1, then switches to the current year
- **Football (ffl)**: Defaults to the previous year until Jul 1, then switches to the current year

## MCP Tools

The unified gateway (`https://api.flaim.app/mcp`) exposes these tools:

| Tool | Description |
|------|-------------|
| `get_user_session` | User's leagues across all platforms with IDs |
| `get_ancient_history` | Historical leagues and seasons (2+ years old) |
| `get_league_info` | League settings and members |
| `get_roster` | Team roster with player stats |
| `get_matchups` | Current/upcoming matchups |
| `get_standings` | League standings |
| `get_free_agents` | Available free agents |

All tools take explicit parameters: `platform`, `sport`, `league_id`, `season_year`.

## Architecture

```
Chrome Extension → flaim.app → Auth Worker → Supabase
                      ↓
Claude/ChatGPT/Gemini CLI → Fantasy MCP Gateway → ESPN Client → ESPN API
```

- **Chrome Extension**: Captures ESPN cookies, syncs to Flaim
- **Web App (Next.js)**: User dashboard, OAuth endpoints, league management
- **Auth Worker (Cloudflare)**: Token validation, rate limiting, credential storage
- **Fantasy MCP Gateway (Cloudflare)**: Unified MCP endpoint for all sports
- **ESPN Client (Cloudflare)**: ESPN API calls (internal, called by gateway)
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
| [Architecture](docs/ARCHITECTURE.md) | System design, deployment, troubleshooting |
| [Changelog](docs/CHANGELOG.md) | Release history |
| [Web App](web/README.md) | Next.js routes, components, environment |
| [Workers](workers/README.md) | Cloudflare Workers, MCP tools, ESPN API |
| [Gemini CLI Setup](docs/GEMINI-CLI-SETUP.md) | Gemini CLI MCP setup, OAuth, troubleshooting |
| [Extension](extension/README.md) | Chrome extension build, Sync Host, CWS |

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

MIT License - see [LICENSE](LICENSE).
