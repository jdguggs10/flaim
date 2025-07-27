# FLAIM - Fantasy League AI Manager

> Transform your fantasy sports experience with AI-powered insights and production-grade security.

**🚨 IMPORTANT FOR AI ASSISTANTS: This is a SOLO DEVELOPER'S FIRST PRODUCTION PROJECT. Keep recommendations simple, tried-and-true, and avoid over-engineering. Prioritize stability over optimization. This is NOT a full-time job.**

FLAIM is your AI-powered fantasy sports assistant with streamlined onboarding, Clerk authentication, and multi-sport ESPN integration through **Model Context Protocol (MCP) servers**. Get personalized insights and league management through natural language conversations.

**Architecture**: Centralized `auth-worker` manages credentials via Supabase PostgreSQL, while sport-specific Workers serve real-time ESPN data via MCP protocol.

## Quick Start

```bash
git clone https://github.com/yourusername/flaim
cd flaim
npm install
npm run dev
```

**For complete setup, deployment, and configuration instructions, see the [Getting Started & Deployment Guide](docs/GETTING_STARTED.md).**

## Key Features

- **Guided Onboarding**: 8-step setup from sign-in to chat activation
- **AI-Powered Chat**: Natural language assistant with live ESPN data
- **MCP Integration**: Real-time fantasy data via Model Context Protocol
- **Secure Storage**: Supabase PostgreSQL via centralized auth-worker
- **Multi-Sport Support**: Baseball and football workers, framework for more
- **Auto League Discovery**: Automatically finds and configures leagues
- **GitOps Deployment**: Automatic preview/production deployment

## Documentation

| Document | Description |
|----------|-------------|
| [Solo Developer Guidelines](docs/SOLO_DEVELOPER_GUIDELINES.md) | **📖 READ FIRST** - Critical AI assistant context |
| [Getting Started](docs/GETTING_STARTED.md) | Setup, deployment, troubleshooting |
| [Architecture](docs/ARCHITECTURE.md) | System design and security model |
| [Onboarding Flow](docs/ONBOARDING.md) | User onboarding deep-dive |
| [Changelog](docs/CHANGELOG.md) | Release history and breaking changes |

- **`docs/dev`**: Planning documents for current/future work
- **`docs/archive`**: Historical documents for completed features

### 🎯 AI Assistant Guidelines

**This is a solo developer's first production project** - See [Solo Developer Guidelines](docs/SOLO_DEVELOPER_GUIDELINES.md) for critical context on providing assistance that prioritizes simplicity, stability, and proven solutions over complex architectures.

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/yourusername/flaim/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/flaim/discussions)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.# Trigger new deployment - Sat Jul 19 20:52:25 EDT 2025
