# Migration to GitOps Workflow

## Overview

FLAIM has migrated from custom shell script orchestration to a modern GitOps-driven deployment workflow. This document outlines the key changes and how to adapt.

## What Changed

### ❌ Old Workflow (Removed)
- `./start.sh` - Custom interactive deployment orchestrator
- `./build.sh` - Custom build script with environment management
- Manual environment variable injection
- Complex shell-based service coordination

### ✅ New Workflow (Current)
- Standard npm scripts for all operations
- GitOps-driven deployments via GitHub Actions
- Environment-specific `.env` files
- Native Cloudflare Pages integration (no more `@cloudflare/next-on-pages`)

## New Commands

### Local Development
```bash
# Start all services (replaces ./start.sh)
npm run dev

# Start frontend only
npm run dev:frontend

# Start workers only
npm run dev:workers
```

### Deployment
```bash
# Deploy workers to preview
npm run deploy:workers:preview

# Deploy workers to production
npm run deploy:workers:prod

# Frontend deploys automatically via Cloudflare Pages Git integration
```

### Environment Configuration

#### Local Development
1. Copy `openai/.env.example` to `openai/.env.local`
2. Add your API keys and secrets
3. Run `npm run dev`

#### Preview/Production
- **Frontend**: Configured via Cloudflare Pages environment variables
- **Workers**: Secrets managed via `wrangler secret put`
- **Public vars**: Set in `openai/.env.preview` and `openai/.env.production`

## Migration Steps for Existing Developers

1. **Update your workflow**:
   ```bash
   # Old way
   ./start.sh

   # New way
   npm run dev
   ```

2. **Set up local environment**:
   ```bash
   cp openai/.env.example openai/.env.local
   # Edit .env.local with your keys
   ```

3. **Update deployment process**:
   - **Preview**: Create a pull request (auto-deploys)
   - **Production**: Merge to main branch (auto-deploys)

## Benefits of New Workflow

- **Simplified**: Single command for local development
- **Standard**: Uses industry-standard npm scripts
- **Automated**: No manual deployment steps
- **Reliable**: Platform-native workflows eliminate custom script brittleness
- **Faster**: Automatic preview deployments for every PR

## Troubleshooting

### "Command not found" errors
- Ensure you're running commands from the project root
- Run `npm install` to ensure dependencies are up to date

### Workers not starting locally
- Check that ports 8786-8788 aren't in use
- Verify wrangler is logged in: `wrangler whoami`

### Environment variables not loading
- Verify `.env.local` exists and contains required keys
- Check that secrets are set for remote environments

## Support

If you encounter issues with the new workflow, check:
1. This migration guide
2. Updated documentation in README.md and GETTING_STARTED.md
3. The GitHub repository for examples and discussions