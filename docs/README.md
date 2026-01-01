# Flaim - Fantasy League AI Connector

Flaim connects your ESPN fantasy leagues to AI assistants like Claude and ChatGPT. It's an MCP (Model Context Protocol) service that gives AI tools access to your live fantasy data.

**For helpers:** Solo developer, production project. Keep solutions simple and stable.

## Quick Start

```bash
git clone https://github.com/yourusername/flaim
cd flaim && npm install
cp web/.env.example web/.env.local  # add keys
npm run dev
```

Full setup details: [Architecture](ARCHITECTURE.md).

## How It Works

1. **Connect ESPN** — Use the [Chrome extension](https://chrome.google.com/webstore/detail/flaim) to sync your ESPN credentials automatically (or add them manually)
2. **Add leagues** at `/leagues` — Select which fantasy teams to connect
3. **Connect AI** at `/connectors` — Link Claude.ai, Claude Desktop, or ChatGPT via OAuth
4. **Use MCP tools** — Ask about your roster, matchups, standings directly in your AI

The MCP servers provide real-time ESPN data. Bring your own Claude or ChatGPT subscription.

## What Flaim Is

Flaim is an **authentication and data service** for fantasy sports AI integrations:

- **MCP Server**: Exposes fantasy league data to Claude and ChatGPT via the Model Context Protocol
- **OAuth Provider**: Handles secure authentication between AI clients and your ESPN data
- **Credential Manager**: Securely stores and manages ESPN session cookies

Flaim is **not** a chatbot or AI product itself — it's the bridge that lets you use your preferred AI tool with your fantasy data.

## Features

- **Chrome Extension**: Auto-capture ESPN credentials without manual cookie extraction
- **Claude + ChatGPT OAuth**: Direct access via MCP protocol (OAuth 2.1)
- **Live ESPN Data**: Baseball and football MCP workers with real-time stats
- **Multi-League Support**: Manage multiple leagues across sports
- **Privacy Policy**: `/privacy` page for Chrome Web Store compliance
- **GitOps Deployment**: PR → preview, main → production

## Development Philosophy

Solo developer, hobby project. Priorities:

- **Simple over clever** — Boring, documented tech (Next.js, Vercel, Clerk, Cloudflare, Supabase)
- **Small changes** — 1-2 hour tasks, one new concept at a time
- **Ship working features** — Avoid over-engineering; easy to revert if needed
- **Official docs first** — Copy from examples before inventing patterns

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](ARCHITECTURE.md) | System design, deployment, troubleshooting |
| [Changelog](CHANGELOG.md) | Release history |
| [Web App](../web/README.md) | Next.js routes, components, environment |
| [Workers](../workers/README.md) | Cloudflare Workers, MCP tools, ESPN API |
| [Extension](../extension/README.md) | Chrome extension build, pairing, CWS |

- **`docs/archive/`**: Historical documents for completed features

## MCP Tools

| Tool | Sport | Description |
|------|-------|-------------|
| `get_user_session` | Both | User's leagues, teams, current season |
| `get_espn_league_info` | Baseball | League settings and members |
| `get_espn_team_roster` | Baseball | Team roster with stats |
| `get_espn_matchups` | Baseball | Current/upcoming matchups |
| `get_espn_football_league_info` | Football | League settings and members |
| `get_espn_football_team` | Football | Team roster with stats |
| `get_espn_football_matchups` | Football | Current/upcoming matchups |
| `get_espn_football_standings` | Football | League standings |

## Architecture Overview

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

## Getting Help

- Issues: [GitHub Issues](https://github.com/yourusername/flaim/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/flaim/discussions)

## License

MIT License - see [LICENSE](../LICENSE).
