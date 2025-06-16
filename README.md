# FLAIM - Fantasy League AI Manager

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square)](https://github.com/yourusername/flaim)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Clerk Auth](https://img.shields.io/badge/auth-Clerk-purple?style=flat-square)](https://clerk.com)
[![Cloudflare Workers](https://img.shields.io/badge/deployment-Cloudflare%20Workers-orange?style=flat-square)](https://workers.cloudflare.com)

> **Transform your fantasy sports experience with AI-powered insights and production-grade security**

FLAIM is your AI-powered fantasy sports assistant featuring server-side Clerk authentication, usage-based access tiers, and seamless ESPN integration through the Model Context Protocol (MCP). Get personalized insights, strategic advice, and league management tools through natural language conversations with enterprise-grade security.

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

- **🤖 AI-Powered Chat**: Natural language fantasy sports assistant
- **🔐 Cross-Platform Auth**: Modular authentication system ready for web, iOS, and workers
- **⚾ Multi-Sport Support**: Baseball and football with shared authentication infrastructure
- **🔍 Auto League Discovery**: Automatically finds all your fantasy leagues after ESPN login
- **💰 Usage Tiers**: 100 free messages/month, unlimited paid tier
- **🌐 Serverless**: Cloudflare Workers + Vercel deployment

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [📖 Getting Started](docs/getting-started.md) | Installation, setup, and first steps |
| [🚀 Deployment Guide](docs/deployment.md) | Production deployment and configuration |
| [🏗️ Architecture](docs/architecture.md) | System design and security model |
| [❓ FAQ](docs/faq.md) | Common questions and troubleshooting |
| [🤝 Contributing](docs/contributing.md) | Development workflow and guidelines |
| [📋 Changelog](docs/changelog.md) | Release history and breaking changes |

## 🆕 What's New in v4.1

- ✅ **Automatic League Discovery**: ESPN gambit integration finds all your leagues instantly
- ✅ **Enhanced UX**: No more manual league ID entry - just login and go
- ✅ **Multi-Sport Detection**: Automatic discovery across baseball, football, and more
- ✅ **Graceful Fallbacks**: Manual entry available if auto-discovery fails
- ✅ **Production Security**: Server-side Clerk verification, anti-spoofing protection
- ✅ **Modular Architecture**: Clean separation between auth, discovery, and MCP services

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](docs/contributing.md) for development setup, coding standards, and pull request process.

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