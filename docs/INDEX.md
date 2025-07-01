# FLAIM Documentation

Welcome to the FLAIM (Fantasy League AI Manager) documentation. This guide will help you understand, deploy, and contribute to the AI-powered fantasy sports platform.

## 📋 Table of Contents

### Getting Started
- **[📖 Getting Started Guide](GETTING_STARTED.md)** - Installation, setup, and your first 5 minutes with FLAIM
- **[🚀 Deployment Guide](DEPLOYMENT.md)** - Production deployment, environment configuration, and scaling

### Understanding FLAIM
- **[🏗️ Architecture Overview](ARCHITECTURE.md)** - System design, security model, and component interaction
- **[🔧 MCP Integration](MCP_INTEGRATION.md)** - Model Context Protocol servers, tools, and ESPN data access
- **[❓ FAQ](FAQ.md)** - Common questions, troubleshooting, and solutions


## 🎯 Quick Navigation by Role

### **New Users**
1. Start with [Getting Started](GETTING_STARTED.md) for installation
2. Check [FAQ](FAQ.md) for common setup issues
3. Review [Architecture](ARCHITECTURE.md) to understand the platform

### **Developers** 
1. Study [Architecture](ARCHITECTURE.md) for system understanding
2. Review [MCP Integration](MCP_INTEGRATION.md) for ESPN data access patterns
3. Check [Changelog](CHANGELOG.md) for recent changes

### **DevOps/Admins**
1. Follow [Deployment Guide](DEPLOYMENT.md) for production setup
2. Review [Architecture](ARCHITECTURE.md) for security requirements
3. Reference [FAQ](FAQ.md) for operational troubleshooting

## 🔐 Security & Production

FLAIM v4.0 features production-grade security:
- **Server-side Clerk verification** prevents header spoofing
- **Environment isolation** disables development shortcuts in production
- **Encrypted credential storage** with AES-GCM in Durable Objects
- **Comprehensive error handling** with user-friendly messages

## 🆕 What's New in v6.1

- ✅ **MCP Protocol Integration**: Dedicated Cloudflare Workers providing standardized ESPN fantasy data access
- ✅ **Real-time Data**: Live rosters, matchups, standings, and league settings via MCP servers
- ✅ **Sport-specific Workers**: Separate MCP servers for baseball, football, basketball, and hockey
- ✅ **Auth-worker Architecture**: Centralized credential management with secure KV storage
- ✅ **Enhanced AI Integration**: Claude can analyze live fantasy data through MCP protocol

## 🤝 Getting Help

- **Issues**: [GitHub Issues](https://github.com/yourusername/flaim/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/flaim/discussions)

## 📚 External Resources

- **[Next.js Documentation](https://nextjs.org/docs)** - The React Framework.
- **[Clerk Documentation](https://clerk.com/docs)** - Authentication and user management.
- **[Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)** - Serverless execution environment.
- **[OpenAI API Documentation](https://platform.openai.com/docs)** - AI models and APIs.
- **[Model Context Protocol](https://modelcontextprotocol.io/)** - Standardized protocol for AI tool integration.
- **[Hono Documentation](https://hono.dev/)** - Small, simple, and ultrafast web framework.
- **[ESPN Fantasy API](https://fantasy.espn.com)** - Fantasy sports data source.

---

**Need something specific?** Use the navigation above or search for keywords in the documentation files.