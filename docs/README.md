# Flaim - Fantasy League AI Connector

Flaim connects your ESPN fantasy leagues to AI assistants like Claude and ChatGPT. Set up your leagues once, then use live fantasy data directly in your preferred AI tool.

**For helpers:** Solo developer, production project. Keep solutions simple and stable.

## Quick Start

```bash
git clone https://github.com/yourusername/flaim
cd flaim && npm install
cp web/.env.example web/.env.local  # add keys
npm run dev
```

Full setup details: [Getting Started](GETTING_STARTED.md).

## How It Works

1. **Set up leagues** at `/leagues` — add ESPN credentials and select your teams
2. **Connect AI** at `/connectors` — link Claude.ai, Claude Desktop, or ChatGPT
3. **Use MCP tools** — ask about your roster, matchups, standings directly in your AI

The MCP servers provide real-time ESPN data. Bring your own Claude or ChatGPT subscription.

## Features

- **Claude + ChatGPT Direct Access**: Connect via OAuth 2.1 (MCP protocol)
- **Live ESPN data**: Baseball and football MCP workers
- **Multi-league support**: Manage multiple leagues, set a default
- **Built-in chat**: Optional `/chat` page if you don't have Claude/ChatGPT access
- **GitOps deployment**: PR → preview, main → production

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](ARCHITECTURE.md) | System design, directory structure, security |
| [Getting Started](GETTING_STARTED.md) | Setup and deployment |
| [MCP Connector Research](MCP_CONNECTOR_RESEARCH.md) | Claude + ChatGPT OAuth implementation |
| [Solo Developer Guidelines](SOLO_DEVELOPER_GUIDELINES.md) | Context for keeping solutions simple |
| [Changelog](CHANGELOG.md) | Release history |

- **`docs/dev/`**: Planning documents for current/future work
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

## Getting Help

- Issues: [GitHub Issues](https://github.com/yourusername/flaim/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/flaim/discussions)

## License

MIT License - see [LICENSE](../LICENSE).
