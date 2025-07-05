# FLAIM - Fantasy League AI Manager

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square)](https://github.com/yourusername/flaim)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Clerk Auth](https://img.shields.io/badge/auth-Clerk-purple?style=flat-square)](https://clerk.com)
[![Cloudflare Workers](https://img.shields.io/badge/deployment-Cloudflare%20Workers-orange?style=flat-square)](https://workers.cloudflare.com)

> **Transform your fantasy sports experience with AI-powered insights and production-grade security**

FLAIM is your AI-powered fantasy sports assistant featuring a streamlined onboarding experience, server-side Clerk authentication, and seamless multi-platform fantasy sports integration through **Model Context Protocol (MCP) servers**. Get personalized insights, strategic advice, and league management tools through natural language conversations with enterprise-grade security.

**🔧 MCP Architecture**: Dedicated Cloudflare Workers provide real-time ESPN fantasy data access via standardized MCP protocol, enabling Claude to analyze your leagues, rosters, matchups, and standings with live data integration.

## 🚀 Quick Start

### Interactive Development Launcher
```bash
git clone https://github.com/yourusername/flaim
cd flaim
./setup.sh              # One-time setup for local development
./build.sh              # Build production artifacts (optional)
./start.sh              # Interactive launcher for flexible deployment
```

The interactive launcher lets you mix and match deployment modes:
- **Local dev**: Traditional local development with health checks
- **Remote preview**: Wrangler remote development with live URLs
- **Deploy preview/prod**: Deploy to Cloudflare environments
- **Skip**: Disable specific workers

### One-Click Production Deployment
```bash
git clone https://github.com/yourusername/flaim
cd flaim
./start-prod.sh    # Deploys everything to Cloudflare
```

**Ready in 5 minutes!** See [Getting Started Guide](docs/GETTING_STARTED.md) for detailed setup.

## ✨ Key Features

- **🛤️ Guided Onboarding**: 8-step setup from sign-in to chat activation
- **🤖 AI-Powered Chat**: Natural language fantasy sports assistant with live ESPN data
- **🔧 MCP Integration**: Real-time fantasy data via Model Context Protocol servers
- **🔐 Secure Credential Storage**: CF KV with AES-GCM encryption and key rotation
- **⚾ Multi-Sport Support**: Baseball, football, basketball, and hockey MCP workers
- **🔍 Auto League Discovery**: Automatically finds and configures your fantasy leagues
- **🛠️ Auto-Configuration**: MCP tools configured automatically based on your leagues
- **📊 Live Data Access**: Real-time rosters, matchups, standings, and league settings
- **🚀 Interactive Deployment**: Mix local/remote/deployed workers with single command
- **💰 Usage Tiers**: 100 free messages/month, unlimited paid tier
- **🌐 Serverless**: Cloudflare Workers + Next.js deployment

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [📖 Getting Started](docs/GETTING_STARTED.md) | Installation, setup, and first steps |
| [🛤️ Onboarding Flow](docs/ONBOARDING.md) | Complete user onboarding experience guide |
| [🔧 MCP Integration](docs/MCP_INTEGRATION.md) | Model Context Protocol servers and tools |
| [🚀 Deployment Guide](docs/DEPLOYMENT.md) | Production deployment and configuration |
| [🏗️ Architecture](docs/ARCHITECTURE.md) | System design and security model |
| [❓ FAQ](docs/FAQ.md) | Common questions and troubleshooting |
| [📋 Changelog](docs/CHANGELOG.md) | Release history and breaking changes |

## 🆕 What's New in v5.0

### 🏗️ **Modular Build Architecture**
- ✅ **Build Target Separation**: Shared, workers, and web code compile independently
- ✅ **Scoped Imports**: Clean `@flaim/auth/*` imports replace brittle relative paths
- ✅ **Client/Server Separation**: Prevents "server-only" errors in React components
- ✅ **TypeScript Path Mapping**: Automatic import resolution across the monorepo

### 🔗 **Developer Experience**
- ✅ **Interactive Development Launcher**: Mix local/remote/deployed workers in one command
- ✅ **True NPM Workspace**: Root package.json with proper dependency hoisting
- ✅ **Single Next.js Installation**: No more duplicate dependencies or type conflicts
- ✅ **ESLint v9 Support**: Modern linting with typescript-eslint v8 compatibility
- ✅ **Hot Reloading**: Changes reflect immediately during development
- ✅ **Consistent API**: Same auth interface across all platforms
- ✅ **Type-Safe Auth Wrappers**: Explicit union types for redirect/success/error responses

### 🎯 **Platform Features**
- ✅ **Complete Onboarding Redesign**: Streamlined 8-step setup flow from sign-in to chat
- ✅ **Multi-Platform Architecture**: ESPN active, Yahoo framework ready
- ✅ **Auto-Sport Detection**: Automatic sport identification from league data
- ✅ **Smart MCP Configuration**: Tools auto-configure based on platform and sport selection
- ✅ **Mobile-First Design**: Responsive onboarding experience across all devices


## ⚠️ Important Notes

### MCP & KV Storage Runtime Requirements
**CF KV credential storage and MCP servers are only available in Cloudflare Workers runtime.** The system is designed for Workers-first deployment:
- ✅ **Production**: Cloudflare Workers with KV namespace bindings and MCP protocol support
- ✅ **Development**: Mock KV for testing (NODE_ENV=development/test)
- ❌ **Node.js Production**: KV client and MCP servers not implemented for Node.js production SSR

**MCP Architecture**: Dedicated sport-specific Cloudflare Workers provide standardized ESPN fantasy data access via Model Context Protocol, enabling real-time league analysis and management through AI assistants.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  <strong>Built with ❤️ for the fantasy sports community</strong>
  <br><br>
  <img src="https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/Clerk-Auth-purple?style=for-the-badge&logo=clerk" alt="Clerk Auth" />
  <img src="https://img.shields.io/badge/Cloudflare-Workers-orange?style=for-the-badge&logo=cloudflare" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/OpenAI-API-green?style=for-the-badge&logo=openai" alt="OpenAI API" />
</div>