# Flaim Fantasy

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP Tools](https://img.shields.io/badge/MCP_Tools-9-green.svg)](https://api.flaim.app/mcp)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Extension-v1.5.1-yellow.svg)](https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn)

Connect your ESPN, Yahoo, and Sleeper leagues to ChatGPT, Claude, and Gemini CLI so you can ask about your actual team, matchup, standings, and waiver wire. Flaim combines live league data with built-in fantasy analyst guidance, so the answers are grounded in your league instead of generic rankings.

Read-only by design. No trades, no drops, no roster changes — just advice.

## How It Works

The **Flaim skill** teaches your AI assistant how to behave like a fantasy analyst — which data to pull, how to interpret it, and how to turn it into useful advice. The **MCP tools** feed it your actual league data. Together, they give a general-purpose AI enough structure to answer like it knows your specific league.

## Get Started

1. **Sign up** at [flaim.app](https://flaim.app)
2. **Connect your platforms** — ESPN via [Chrome extension](https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn), Yahoo via OAuth, Sleeper by username
3. **Leagues auto-discovered** — all your leagues and past seasons are found automatically
4. **Pick a default league** for AI conversations
5. **Install the skill** — recommended for agent-skill tools; copy `.agents/skills/flaim-fantasy/` into your project or home directory (see [The Skill](#the-skill) below)
6. **Add Flaim to your AI** — use the MCP URL in Claude, ChatGPT, or Gemini CLI
7. **Ask questions** — "Who should I start this week?", "What's on the waiver wire?", etc.

## The Skill

The Flaim skill teaches your AI assistant how to behave like a fantasy analyst — when to use which tools, how to interpret league data, and how to turn that context into useful advice.

**Install for Claude Code (or any Agent Skills-compatible tool):**

Place the skill in your project's `.agents/skills/` directory (cross-platform convention) or in `~/.agents/skills/` for global use:

```bash
# Clone or copy the skill directory
cp -r flaim/.agents/skills/flaim-fantasy ~/.agents/skills/flaim-fantasy
```

The AI will detect and activate the skill automatically when you ask fantasy questions.

## MCP Tools

| Tool | What it does |
|------|-------------|
| `get_user_session` | Your leagues across all platforms |
| `get_ancient_history` | Past seasons and historical leagues outside the current season |
| `get_league_info` | Baseline league context: settings, scoring, roster config, teams/owners |
| `get_roster` | Team roster with player stats |
| `get_matchups` | Weekly matchups and scores |
| `get_standings` | League standings and rankings |
| `get_free_agents` | Available players; ESPN/Yahoo include ownership percentages, Sleeper returns identities only |
| `get_players` | Player lookup; ESPN and Yahoo can add league ownership, Sleeper ownership is unavailable |
| `get_transactions` | Recent adds, drops, waivers, and trades |

All tools connect through a single MCP endpoint: `https://api.flaim.app/mcp`

For eval and observability runs, Flaim also supports an eval-only traced alias:

- `https://api.flaim.app/mcp/r/<run_id>/t/<trace_id>`

Normal clients should continue to use the base `/mcp` endpoint.

## Supported Platforms

| Platform | Sports | Auth |
|----------|--------|------|
| **ESPN** | Football, Baseball, Basketball, Hockey | Chrome extension or manual cookies |
| **Yahoo** | Football, Baseball, Basketball, Hockey | OAuth 2.0 |
| **Sleeper** | Football, Basketball | Username (public API) |

## Architecture

```
Chrome Extension → flaim.app → Auth Worker → Supabase
                      ↓
Claude/ChatGPT/Gemini CLI → Fantasy MCP Gateway → ESPN/Yahoo/Sleeper Clients → Platform APIs
```

- **Web App (Next.js on Vercel)** — landing/site pages, public live demo, OAuth, league management
- **MCP Gateway (Cloudflare Workers)** — unified endpoint for all platforms and sports
- **Platform Clients (Cloudflare Workers)** — ESPN, Yahoo, Sleeper API normalization
- **Auth Worker (Cloudflare)** — token validation, rate limiting, credential storage
- **Supabase** — user data, OAuth tokens, credentials

## About

Solo indie project — built with care, maintained for the long term. No VC funding, no growth pressure, just a useful tool for fantasy sports fans who use AI.

## Development

```bash
git clone https://github.com/jdguggs10/flaim.git
cd flaim && npm install
cp web/.env.example web/.env.local  # add keys
npm run dev
```

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, deployment, troubleshooting |
| [Changelog](docs/CHANGELOG.md) | Release history |
| [Web App](web/README.md) | Next.js routes, components, environment |
| [Workers](workers/README.md) | Cloudflare Workers, MCP tools, ESPN API |
| [Extension](extension/README.md) | Chrome extension build, Sync Host, CWS |

## Getting Help

Best-effort support — I'll respond when I can.

- [GitHub Issues](https://github.com/jdguggs10/flaim/issues)
- [GitHub Discussions](https://github.com/jdguggs10/flaim/discussions)

## License

MIT License — see [LICENSE](LICENSE).
