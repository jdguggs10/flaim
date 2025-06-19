# FLAIM - Fantasy League AI Manager

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square)](https://github.com/yourusername/flaim)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Clerk Auth](https://img.shields.io/badge/auth-Clerk-purple?style=flat-square)](https://clerk.com)
[![Cloudflare Workers](https://img.shields.io/badge/deployment-Cloudflare%20Workers-orange?style=flat-square)](https://workers.cloudflare.com)

> **Transform your fantasy sports experience with AI-powered insights and production-grade security**

FLAIM is your AI-powered fantasy sports assistant featuring a streamlined onboarding experience, server-side Clerk authentication, and seamless multi-platform fantasy sports integration through the Model Context Protocol (MCP). Get personalized insights, strategic advice, and league management tools through natural language conversations with enterprise-grade security.

## 🚀 Quick Start

### One-Click Local Development
```bash
git clone https://github.com/yourusername/flaim
cd flaim
./setup.sh              # One-time setup for local development
./start-dev.sh          # Start all services for development
```

### One-Click Production Deployment
```bash
git clone https://github.com/yourusername/flaim
cd flaim
./start-prod.sh    # Deploys everything to Cloudflare
```

**Ready in 5 minutes!** See [Getting Started Guide](docs/getting-started.md) for detailed setup.

## ✨ Key Features

- **🛤️ Guided Onboarding**: 8-step setup from sign-in to chat activation
- **🤖 AI-Powered Chat**: Natural language fantasy sports assistant  
- **🔐 Secure Credential Storage**: CF KV with AES-GCM encryption and key rotation
- **⚾ Multi-Sport Support**: Baseball, football, basketball, and hockey
- **🔍 Auto League Discovery**: Automatically finds and configures your fantasy leagues
- **🛠️ Auto-Configuration**: MCP tools configured automatically based on your leagues
- **📊 Manual League Entry**: Alternative flow for complex setups (up to 10 leagues)
- **💰 Usage Tiers**: 100 free messages/month, unlimited paid tier
- **🌐 Serverless**: Cloudflare Workers + Vercel deployment

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [📖 Getting Started](docs/getting-started.md) | Installation, setup, and first steps |
| [🛤️ Onboarding Flow](docs/onboarding-flow.md) | Complete user onboarding experience guide |
| [🚀 Deployment Guide](docs/deployment.md) | Production deployment and configuration |
| [🏗️ Architecture](docs/architecture.md) | System design and security model |
| [❓ FAQ](docs/faq.md) | Common questions and troubleshooting |
| [🤝 Contributing](docs/contributing.md) | Development workflow and guidelines |
| [📋 Changelog](docs/changelog.md) | Release history and breaking changes |

## 🆕 What's New in v5.0

### 🏗️ **Modular Build Architecture**
- ✅ **Build Target Separation**: Shared, workers, and web code compile independently
- ✅ **Scoped Imports**: Clean `@flaim/auth/*` imports replace brittle relative paths
- ✅ **Client/Server Separation**: Prevents "server-only" errors in React components
- ✅ **TypeScript Path Mapping**: Automatic import resolution across the monorepo

### 🔗 **Developer Experience**
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

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](docs/contributing.md) for development setup, coding standards, and pull request process.

## ⚠️ Important Notes

### KV Storage Runtime Requirements
**CF KV credential storage is only available in Cloudflare Workers runtime.** The system is designed for Workers-first deployment:
- ✅ **Production**: Cloudflare Workers with KV namespace bindings
- ✅ **Development**: Mock KV for testing (NODE_ENV=development/test)
- ❌ **Node.js Production**: KV client not implemented for Node.js production SSR

For server-side credential access in Next.js production, use API routes that proxy to Workers.

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