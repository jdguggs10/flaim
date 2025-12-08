# FLAIM - Fantasy League AI Manager

AI-powered fantasy sports assistant with Clerk auth, Supabase storage, and sport-specific MCP workers for real-time ESPN data. Uses the OpenAI **Responses API** (not legacy chat completions).

**For helpers:** Solo developer, production project. Keep solutions simple and stable.

## Quick Start

1) `git clone https://github.com/yourusername/flaim`
2) `cd flaim && npm install`
3) `cp openai/.env.example openai/.env.local` and add keys
4) `npm run dev`

Full setup details: [Getting Started & Deployment Guide](docs/GETTING_STARTED.md).

## Highlights

- Guided onboarding from sign-in to chat
- Live ESPN data via MCP workers (baseball, football)
- Centralized auth-worker + Supabase for credentials/leagues
- Automatic league discovery and sport detection
- GitOps: PR → preview, main → production

## Documentation

| Document | Description |
|----------|-------------|
| Document | Description |
|----------|-------------|
| [Solo Developer Guidelines](docs/SOLO_DEVELOPER_GUIDELINES.md) | Context for keeping solutions simple |
| [Getting Started](docs/GETTING_STARTED.md) | Setup and deployment |
| [Architecture](docs/ARCHITECTURE.md) | System design and security |
| [Onboarding Flow](docs/ONBOARDING.md) | User onboarding steps |
| [Changelog](docs/CHANGELOG.md) | Release history |

- **`docs/dev`**: Planning documents for current/future work
- **`docs/archive`**: Historical documents for completed features

## Getting Help

- Issues: [GitHub Issues](https://github.com/yourusername/flaim/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/flaim/discussions)

## License

MIT License - see [LICENSE](LICENSE).
