# FLAIM - Fantasy League AI Manager

> Transform your fantasy sports experience with AI-powered insights and production-grade security.

FLAIM is your AI-powered fantasy sports assistant featuring a streamlined onboarding experience, server-side Clerk authentication, and seamless multi-platform fantasy sports integration through **Model Context Protocol (MCP) servers**. Get personalized insights, strategic advice, and league management tools through natural language conversations with enterprise-grade security.

**MCP Architecture**: A dedicated `auth-worker` provides centralized, secure credential management while sport-specific Cloudflare Workers serve real-time ESPN fantasy data via the standardized MCP protocol. This enables AI assistants to analyze your leagues, rosters, matchups, and standings with live, user-specific data.

## Quick Start

Modern GitOps workflow with standard npm commands:

```bash
git clone https://github.com/yourusername/flaim
cd flaim

# Install dependencies
npm install

# Start local development (all services)
npm run dev

# Deploy workers to preview environment
npm run deploy:workers:preview

# Deploy workers to production
npm run deploy:workers:prod
```

**Frontend deployment is automatic**: Push to a PR for preview deployment, merge to `main` for production deployment via Cloudflare Pages Git integration.

**For detailed setup and deployment instructions, see the [Getting Started & Deployment Guide](docs/GETTING_STARTED.md).**

## Key Features

- **Guided Onboarding**: 8-step setup from sign-in to chat activation.
- **AI-Powered Chat**: Natural language fantasy sports assistant with live ESPN data.
- **MCP Integration**: Real-time fantasy data via Model Context Protocol servers.
- **Secure Credential Storage**: CF KV with AES-GCM encryption managed by a central `auth-worker`.
- **Multi-Sport Support**: Baseball and football MCP workers ready, with a framework for more.
- **Auto League Discovery**: Automatically finds and configures your fantasy leagues.
- **GitOps Deployment**: Automatic preview deployments for PRs, production deployment on main branch merge.
- **Usage Tiers**: 100 free messages/month, with an unlimited paid tier.
- **Serverless**: Cloudflare Workers + Next.js deployment.

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started & Deployment](docs/GETTING_STARTED.md) | Installation, setup, deployment, and troubleshooting. |
| [Architecture](docs/ARCHITECTURE.md) | System design, security model, and component interaction. |
| [Onboarding Flow](docs/ONBOARDING.md) | A deep-dive into the in-app user onboarding feature. |
| [MCP Integration](docs/dev/MCP_INTEGRATION.md) | Guide to the Model Context Protocol servers and tools. |
| [Changelog](docs/CHANGELOG.md) | Release history and breaking changes. |

### Documentation Structure

- **`docs/dev`**: Contains planning documents and notes for work that is currently in progress or planned for the near future.
- **`docs/archive`**: Contains historical documents for features and refactors that have already been completed.

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/yourusername/flaim/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/flaim/discussions)

## External Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Clerk Documentation](https://clerk.com/docs)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Hono Documentation](https://hono.dev/)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.