# FLAIM Documentation

Welcome to the FLAIM (Fantasy League AI Manager) documentation. This guide will help you understand, deploy, and contribute to the AI-powered fantasy sports platform.

## 📋 Table of Contents

### Getting Started
- **[📖 Getting Started Guide](getting-started.md)** - Installation, setup, and your first 5 minutes with FLAIM
- **[🚀 Deployment Guide](deployment.md)** - Production deployment, environment configuration, and scaling

### Understanding FLAIM
- **[🏗️ Architecture Overview](architecture.md)** - System design, security model, and component interaction
- **[❓ FAQ](faq.md)** - Common questions, troubleshooting, and solutions

### Contributing
- **[🤝 Contributing Guide](contributing.md)** - Development setup, coding standards, and PR workflow
- **[📋 Changelog](changelog.md)** - Release history, version notes, and breaking changes

## 🎯 Quick Navigation by Role

### **New Users**
1. Start with [Getting Started](getting-started.md) for installation
2. Check [FAQ](faq.md) for common setup issues
3. Review [Architecture](architecture.md) to understand the platform

### **Developers** 
1. Read [Contributing Guide](contributing.md) for development setup
2. Study [Architecture](architecture.md) for system understanding
3. Check [Changelog](changelog.md) for recent changes

### **DevOps/Admins**
1. Follow [Deployment Guide](deployment.md) for production setup
2. Review [Architecture](architecture.md) for security requirements
3. Reference [FAQ](faq.md) for operational troubleshooting

## 🔐 Security & Production

FLAIM v4.0 features production-grade security:
- **Server-side Clerk verification** prevents header spoofing
- **Environment isolation** disables development shortcuts in production
- **Encrypted credential storage** with AES-GCM in Durable Objects
- **Comprehensive error handling** with user-friendly messages

## 🆕 What's New in v4.1

- ✅ **Automatic League Discovery**: ESPN gambit integration finds all your leagues instantly
- ✅ **Enhanced UX**: No more manual league ID entry - just login and go
- ✅ **Multi-Sport Detection**: Automatic discovery across baseball, football, and more
- ✅ **Production security hardening** with anti-spoofing protection
- ✅ **Enhanced error handling** and user experience

## 🤝 Getting Help

- **Issues**: [GitHub Issues](https://github.com/yourusername/flaim/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/flaim/discussions)
- **Security**: See [Contributing Guide](contributing.md#security) for responsible disclosure

## 📚 External Resources

- **[Clerk Documentation](https://clerk.com/docs)** - Authentication setup and configuration
- **[Cloudflare Workers](https://developers.cloudflare.com/workers/)** - Serverless deployment platform
- **[OpenAI API](https://platform.openai.com/docs)** - AI integration and usage
- **[ESPN Fantasy API](https://fantasy.espn.com)** - Fantasy sports data source

---

**Need something specific?** Use the navigation above or search for keywords in the documentation files.