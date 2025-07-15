# FLAIM - Fantasy League AI Manager

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square)](https://github.com/yourusername/flaim)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Clerk Auth](https://img.shields.io/badge/auth-Clerk-purple?style=flat-square)](https://clerk.com)
[![Cloudflare Workers](https://img.shields.io/badge/deployment-Cloudflare%20Workers-orange?style=flat-square)](https://workers.cloudflare.com)

> **Transform your fantasy sports experience with AI-powered insights and production-grade security**

FLAIM is your AI-powered fantasy sports assistant featuring a streamlined onboarding experience, server-side Clerk authentication, and seamless multi-platform fantasy sports integration through **Model Context Protocol (MCP) servers**. Get personalized insights, strategic advice, and league management tools through natural language conversations with enterprise-grade security.

**🔧 MCP Architecture**: A dedicated `auth-worker` provides centralized, secure credential management while sport-specific Cloudflare Workers serve real-time ESPN fantasy data via the standardized MCP protocol. This enables AI assistants to analyze your leagues, rosters, matchups, and standings with live, user-specific data.

## 🚀 Quick Start

### Three-Environment Deployment
FLAIM uses industry-standard environment terminology:
- **`dev`**: Local development on your machine with hot-reloading
- **`preview`**: Remote staging environment for testing and review  
- **`prod`**: Live production environment

Development workflow managed by two core scripts:
- `./build.sh`: Non-interactive production artifact builder (ideal for CI/CD)
- `./start.sh`: Interactive orchestrator for all environments **← Your main entry point**

```bash
git clone https://github.com/yourusername/flaim
cd flaim

# 1. Build production artifacts
./build.sh

# 2. Deploy to any environment interactively
./start.sh
```

Choose your target environment in the interactive menu:
- **Option 1**: `dev` - Run all services locally
- **Option 2**: `preview` - Deploy to staging environment
- **Option 3**: `prod` - Deploy to production

**Ready in 5 minutes!** See the [Getting Started Guide](docs/GETTING_STARTED.md) for detailed setup.

## ✨ Key Features

- **🛤️ Guided Onboarding**: 8-step setup from sign-in to chat activation
- **🤖 AI-Powered Chat**: Natural language fantasy sports assistant with live ESPN data
- **🔧 MCP Integration**: Real-time fantasy data via Model Context Protocol servers
- **🔐 Secure Credential Storage**: CF KV with AES-GCM encryption managed by a central `auth-worker`.
- **⚾ Multi-Sport Support**: Baseball and football MCP workers ready, with a framework for more.
- **🔍 Auto League Discovery**: Automatically finds and configures your fantasy leagues.
- **🛠️ Auto-Configuration**: MCP tools configured automatically based on your leagues.
- **📊 Live Data Access**: Real-time rosters, matchups, standings, and league settings.
- **🚀 Interactive Deployment**: A single, powerful script to manage all deployment scenarios.
- **🌐 Cloudflare Pages**: Modern deployment with Direct Upload and automatic branch previews.
- **💰 Usage Tiers**: 100 free messages/month, with an unlimited paid tier.
- **🌐 Serverless**: Cloudflare Workers + Next.js deployment.

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [📖 Getting Started](docs/GETTING_STARTED.md) | Installation, setup, and first steps |
| [🚀 Deployment Guide](docs/DEPLOYMENT.md) | Production deployment and configuration |
| [🏗️ Architecture](docs/ARCHITECTURE.md) | System design and security model |
| [🛤️ Onboarding Flow](docs/ONBOARDING.md) | Complete user onboarding experience guide |
| [🔧 MCP Integration](docs/MCP_INTEGRATION.md) | Model Context Protocol servers and tools |
| [❓ FAQ](docs/FAQ.md) | Common questions and troubleshooting |
| [📋 Changelog](docs/CHANGELOG.md) | Release history and breaking changes |

## 🆕 What's New in v6.0

### 🏗️ **Major Architectural Enhancements**
- ✅ **Centralized Auth Worker**: All credential and league management is now handled by a dedicated `auth-worker`, making sport-specific workers stateless and more secure.
- ✅ **Encrypted KV Storage**: Migrated from Durable Objects to Cloudflare KV with AES-GCM encryption for enterprise-grade credential security.
- ✅ **Upgraded Stack**: Core frameworks updated to **React 19** and **Next.js 15**.

### 🔗 **Developer Experience**
- ✅ **Three-Environment Architecture**: Industry-standard `dev`/`preview`/`prod` terminology with secure environment separation
- ✅ **Interactive Development Launcher**: Single `start.sh` script manages all deployment scenarios, replacing legacy tools
- ✅ **True NPM Workspace**: Single root `package.json` with proper dependency hoisting eliminates conflicts
- ✅ **Scoped Imports**: Clean `@flaim/auth/*` imports replace brittle relative paths
- ✅ **Wrangler v4.0 Support**: Latest Cloudflare CLI with modern JavaScript features

### 🎯 **Platform Features**
- ✅ **Complete Onboarding Redesign**: Streamlined 8-step setup flow from sign-in to chat.
- ✅ **Auto-Sport Detection**: Automatic sport identification from league data.
- ✅ **Smart MCP Configuration**: Tools auto-configure based on platform and sport selection.


## ⚠️ Important Notes

### Environment & Runtime Requirements
**CF KV credential storage and MCP servers are only available in Cloudflare Workers runtime.** The system is designed for Workers-first deployment:
- ✅ **Production (`prod`)**: Cloudflare Workers with KV namespace bindings and MCP protocol support
- ✅ **Preview (`preview`)**: Production-like staging environment with full security features
- ✅ **Development (`dev`)**: Local development with mock KV for testing
- ✅ **Cloudflare Pages**: Direct Upload deployment with automatic branch previews
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