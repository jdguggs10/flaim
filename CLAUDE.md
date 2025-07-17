# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FLAIM (Fantasy League AI Manager) is a modern microservices platform providing AI-powered fantasy sports management through MCP (Model Context Protocol) tools. The architecture uses Clerk authentication with usage-based access controls and Cloudflare infrastructure.

**Core Architecture**:
- **Next.js Frontend** (`/openai`) - AI assistant with 100 free messages/month, paid unlimited tier
- **Auth Module** (`/auth`) - Cross-platform authentication (web/iOS/workers) with usage tracking
- **Baseball MCP Worker** (`/workers/baseball-espn-mcp`) - ESPN fantasy baseball integration
- **Football MCP Worker** (`/workers/football-espn-mcp`) - ESPN fantasy football integration
- **Test Suite** (`/tests`) - Comprehensive testing infrastructure

## Development Commands

### Core Scripts
- `./build.sh` - Production artifact builder (non-interactive, CI-friendly)
- `./start.sh` - Interactive development orchestrator (main entry point)

### Frontend (Next.js in `/openai`)
```bash
cd openai
npm run dev          # Development server (port 3000)
npm run build        # Production build
npm run lint         # ESLint check
```

### Auth Module (`/auth`)
```bash
cd auth
npm run build        # Build all targets (shared/workers/web)
npm run type-check   # Type check all configurations
npm test             # Run Jest tests
npm run test:coverage # Test coverage report
```

### Workers
```bash
# Auth Worker
cd workers/auth-worker
npm run type-check
wrangler dev --env dev --port 8786

# Baseball ESPN MCP
cd workers/baseball-espn-mcp  
npm run type-check
wrangler dev --env dev --port 8787

# Football ESPN MCP
cd workers/football-espn-mcp
npm run type-check
wrangler dev --env dev --port 8788
```

### Testing (`/tests`)
```bash
cd tests
npm test                    # All tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
npm run test:e2e           # Playwright e2e tests
npm run test:coverage      # Coverage report
```

## Architecture Guidelines

### Monorepo Structure
- **NPM workspaces** with dependency hoisting at root
- **Single Next.js installation** prevents type conflicts
- **Path aliases** avoid deep relative imports
- **Build target separation** (shared/workers/web in auth module)

### Security Model
- **Clerk authentication** with server-side verification
- **AES-GCM encryption** for ESPN credentials in CF KV
- **Per-user data isolation** with verified Clerk user IDs
- **Usage tracking** (100 free messages/month, unlimited paid)

### MCP Integration
Workers expose MCP tools for fantasy sports data:
- `get_espn_league_info` - League settings and metadata
- `get_espn_team_roster` - Team roster details  
- `get_espn_matchups` - Current week matchups

## Technology Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Authentication**: Clerk v6.22.0 with @clerk/backend v2.1.0
- **Infrastructure**: Cloudflare Workers, Pages, KV
- **Testing**: Jest, Playwright
- **Linting**: ESLint v9 with typescript-eslint v8

## Development Workflow

1. **Environment Setup**: Use `./start.sh` for interactive development
2. **Local Development**: All services run on localhost (workers on 8786-8788, frontend on 3000)
3. **Testing**: Run tests before committing (`npm test` in respective directories)
4. **Type Checking**: Ensure all workers pass type-check before deployment
5. **Building**: Use `./build.sh` for production artifacts

## Key Considerations

- **Node.js 20 required** (check engines in package.json files)
- **Wrangler CLI** needed for worker development and deployment
- **Environment variables** configured per service (see docs/ARCHITECTURE.md)
- **Clerk session verification** required for protected endpoints
- **ESPN credentials** encrypted in CF KV with user-specific keys

## File Structure Patterns

```
/openai          # Next.js frontend
/auth            # Cross-platform auth module
  /shared        # Platform-agnostic logic
  /clerk/web     # Next.js implementation
  /dist          # Built artifacts
/workers         # Cloudflare Workers
  /auth-worker   # Central auth service
  /baseball-*    # Sport-specific MCP
  /football-*    # Sport-specific MCP
/tests           # Test infrastructure
/docs            # Architecture documentation
```

## When to Use MCP Tools

Check `mcp__context7__resolve-library-id` and `mcp__context7__get-library-docs` for up-to-date documentation before making changes to:
- OpenAI API integration patterns
- Clerk authentication flows
- Cloudflare Workers best practices
- Next.js 15 App Router features