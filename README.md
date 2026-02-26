# Flaim Fantasy

Doc routing: see `docs/INDEX.md`.

Flaim is a read-only fantasy analysis app for ESPN, Yahoo, and Sleeper leagues. It helps you make lineup, waiver, and matchup decisions by bringing your league context into ChatGPT, Claude, and Gemini CLI.

## How It Works

1. **Create a Clerk account & sign in** — This is where your platform connections and league info are stored
2. **Connect your platforms** — Sync ESPN credentials with the [Chrome extension](https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn) (or manual cookies), connect Yahoo via OAuth, and add your Sleeper username
3. **Leagues auto-discovered** — Extension finds all your leagues + past seasons and saves them
4. **Pick a default** — Select which league to use by default in AI conversations
5. **Connect your AI** — Add Flaim in Claude, ChatGPT, or Gemini CLI using the MCP URL
6. **Use MCP tools** — Ask about your roster, matchups, standings, etc. directly in your AI

## Automation vs Manual (Quick Clarification)

- **Extension (automatic)**: Auto-pulls ESPN s2/swid and saves to supabase. Runs only when the user clicks **Sync / Re-sync**. It discovers leagues + past seasons.
- **Site (manual)**: `/leagues` is independent. Users can add leagues by ID and manually trigger season discovery.

## What Flaim Is

Flaim is a **read-only fantasy decision-support service**:

- **Unified league context**: Normalizes ESPN, Yahoo, and Sleeper data so analysis stays consistent across platforms
- **Season-aware retrieval**: Returns standings, roster, matchup, and free-agent context with explicit platform and season inputs
- **Secure access model**: Uses user-authorized access paths (Yahoo OAuth, Sleeper public API context, ESPN user-provided session credentials)

Flaim cannot place trades, add or drop players, or modify league settings.

## Features

- **Chrome Extension (v1.5.1)**: Auto-capture ESPN credentials without manual cookie extraction
- **Auto-Discovery (v1.2.1+)**: Fan API-based discovery of leagues + past seasons, with granular status messaging and default selection
- **Claude + ChatGPT + Gemini CLI**: Direct access via MCP protocol (OAuth 2.1)
- **Live Multi-Platform Data**: ESPN, Yahoo, and Sleeper workers with real-time stats
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
| `get_transactions` | Recent transactions (adds, drops, waivers, trades) |

All tools take explicit parameters: `platform`, `sport`, `league_id`, `season_year`.
For `get_transactions`, week semantics are platform-specific: ESPN/Sleeper support week windows, while Yahoo uses a recent 14-day timestamp window and ignores explicit `week`. Yahoo `type=waiver` filtering is not supported in v1.

## Architecture

```
Chrome Extension → flaim.app → Auth Worker → Supabase
                      ↓
Claude/ChatGPT/Gemini CLI → Fantasy MCP Gateway → ESPN/Yahoo/Sleeper Clients → Platform APIs
```

- **Chrome Extension**: Captures ESPN cookies, syncs to Flaim
- **Web App (Next.js)**: User dashboard, OAuth endpoints, league management
- **Auth Worker (Cloudflare)**: Token validation, rate limiting, credential storage
- **Fantasy MCP Gateway (Cloudflare)**: Unified MCP endpoint for all sports
- **ESPN Client (Cloudflare)**: ESPN API calls (internal, called by gateway)
- **Yahoo Client (Cloudflare)**: Yahoo API calls (internal, called by gateway)
- **Sleeper Client (Cloudflare)**: Sleeper API calls (internal, called by gateway)
- **Supabase**: User data, OAuth tokens, platform credentials/connections

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
| [flaim-eval README](../flaim-eval/README.md) | Eval harness usage and local Codex skill notes (`flaim-eval-ops`) |
| [Web App](web/README.md) | Next.js routes, components, environment |
| [Workers](workers/README.md) | Cloudflare Workers, MCP tools, ESPN API |
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
