# FLAIM Documentation

Welcome to the FLAIM (Fantasy League AI Manager) documentation. This guide will help you understand, deploy, and contribute to the AI-powered fantasy sports platform.

## 📋 Table of Contents

### Getting Started
- **[📖 Getting Started Guide](GETTING_STARTED.md)** - Installation, setup, and your first 5 minutes with FLAIM
- **[🚀 Deployment Guide](DEPLOYMENT.md)** - Production deployment, environment configuration, and scaling

### Understanding FLAIM
- **[🏗️ Architecture Overview](ARCHITECTURE.md)** - System design, security model, and component interaction
- **[❓ FAQ](FAQ.md)** - Common questions, troubleshooting, and solutions


## 🎯 Quick Navigation by Role

### **New Users**
1. Start with [Getting Started](GETTING_STARTED.md) for installation
2. Check [FAQ](FAQ.md) for common setup issues
3. Review [Architecture](ARCHITECTURE.md) to understand the platform

### **Developers** 
1. Study [Architecture](ARCHITECTURE.md) for system understanding
2. Check [Changelog](CHANGELOG.md) for recent changes

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

## 🆕 What's New in v4.1

- ✅ **Automatic League Discovery**: ESPN Fantasy v3 API automatically discovers your leagues
- ✅ **Enhanced UX**: No more manual league ID entry - just login and go
- ✅ **Multi-Sport Detection**: Automatic discovery across baseball, football, and more
- ✅ **Production security hardening** with anti-spoofing protection
- ✅ **Enhanced error handling** and user experience

## 🤝 Getting Help

- **Issues**: [GitHub Issues](https://github.com/yourusername/flaim/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/flaim/discussions)

## 📚 External Resources

- **[Next.js Documentation](https://nextjs.org/docs)** - The React Framework.
- **[Clerk Documentation](https://clerk.com/docs)** - Authentication and user management.
- **[Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)** - Serverless execution environment.
- **[OpenAI API Documentation](https://platform.openai.com/docs)** - AI models and APIs.
- **[Hono Documentation](https://hono.dev/)** - Small, simple, and ultrafast web framework.
- **[ESPN Fantasy API](https://fantasy.espn.com)** - Fantasy sports data source.

---

**Need something specific?** Use the navigation above or search for keywords in the documentation files.