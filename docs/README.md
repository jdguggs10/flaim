# FLAIM - Fantasy League AI Manager

MCP servers for ESPN fantasy sports, enabling "Bring Your Own AI" (Claude, ChatGPT) to manage your fantasy teams. Includes a web UI for configuration and debugging.

**Project Goal**: Provide robust MCP tools for fantasy sports data that developers and users can connect to their preferred AI clients (Claude Desktop, ChatGPT, etc.). The web interface serves as a management console and debugging tool.

**For helpers**: Solo developer, production project. Keep solutions simple and stable.

## Quick Start

1) `git clone https://github.com/yourusername/flaim`
2) `cd flaim && npm install`
3) `cp openai/.env.example openai/.env.local` and add keys
4) `npm run dev`

Full setup details: [Getting Started & Deployment Guide](docs/GETTING_STARTED.md).

## Highlights

- **Claude Direct Access**: Connect Claude.ai/Desktop directly via OAuth (BYO subscription)
- **Live ESPN Data**: MCP workers for Baseball and Football
- **Management Console**: Web UI for configuring leagues, credentials, and testing connections
- **Debugging Chat**: Built-in OpenAI-based chat interface for verifying worker functionality
- **Centralized Auth**: Clerk + Supabase for secure credential management

## Documentation

| Document | Description |
|----------|-------------|
| [Solo Developer Guidelines](docs/SOLO_DEVELOPER_GUIDELINES.md) | Context for keeping solutions simple |
| [Getting Started](docs/GETTING_STARTED.md) | Setup and deployment |
| [Architecture](docs/ARCHITECTURE.md) | System design and security |
| [Onboarding Flow](docs/ONBOARDING.md) | User onboarding steps |
| [MCP Connector Research](docs/MCP_CONNECTOR_RESEARCH.md) | Claude direct access implementation |
| [Changelog](docs/CHANGELOG.md) | Release history |

- **`docs/dev`**: Planning documents for current/future work
- **`docs/archive`**: Historical documents for completed features

## Getting Help

- Issues: [GitHub Issues](https://github.com/yourusername/flaim/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/flaim/discussions)

## License

MIT License - see [LICENSE](LICENSE).
