# FLAIM Technology Stack Documentation - 2025

> **Purpose**: Comprehensive reference guide for AI coding agents working on the FLAIM platform. This document contains critical information about the project architecture, technology stack, and development patterns.

**Last Updated**: July 15, 2025  
**Next Review**: When major framework versions change or new technologies are adopted

---

## Project Overview

**FLAIM** (Fantasy League AI Manager) is an AI-powered fantasy sports assistant featuring:
- **Architecture**: Centralized `auth-worker` + sport-specific Cloudflare Workers + Next.js frontend
- **Protocol**: Model Context Protocol (MCP) for real-time ESPN fantasy data integration
- **Security**: AES-GCM encrypted credential storage in Cloudflare KV
- **Deployment**: Three-environment architecture (`dev`/`preview`/`prod`)

### Core Design Principles
- **Workers-first**: Built for Cloudflare Workers runtime, not Node.js production
- **Stateless Workers**: Sport-specific workers are stateless; auth-worker handles all credentials
- **MCP Integration**: Live fantasy data via standardized MCP protocol
- **Security-first**: Enterprise-grade encryption and authentication

---

## Frontend Stack

### Next.js 15 + React 19
- **Version**: Next.js 15 with React 19 RC
- **Architecture**: App Router (not Pages Router)
- **Deployment**: Cloudflare Pages with Direct Upload

#### Key Features (2025)
- **App Router**: File-system routing with Server Components
- **Route Handlers**: Modern Web Platform Request/Response APIs
- **Caching**: **WARNING**: **GET handlers are uncached by default** (breaking change from v14)
- **Performance**: Enhanced build times and Fast Refresh

#### Development Patterns
```typescript
// Route Handler Example (app/api/example/route.ts)
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Use Web Platform APIs, not Node.js APIs
  return NextResponse.json({ message: 'Hello from App Router' });
}
```

#### Important Notes for AI Agents
- Use `app/` directory structure, not `pages/`
- Route handlers replace API routes (`pages/api/`)
- Server Components reduce client-side bundle size
- React 19 features available (Actions, useOptimistic, etc.)

---

## Backend Infrastructure

### Cloudflare Workers + Wrangler
- **Runtime**: `workerd` (not Node.js)
- **CLI**: Wrangler v4 for deployment and development
- **Local Dev**: `wrangler dev` on localhost:8787

#### Project Structure
```
workers/
├── auth-worker/           # Centralized credential management
├── baseball-espn-mcp/     # Baseball MCP server
├── football-espn-mcp/     # Football MCP server
└── [future-sport-mcp]/    # Template for new sports
```

#### Environment Configuration
- **Dev**: Local development with mock KV
- **Preview**: Staging with `-dev` worker suffixes
- **Prod**: Production workers without suffixes

#### Key Commands
```bash
# Local development
wrangler dev --env dev

# Deploy to preview
wrangler deploy --env preview

# Deploy to production
wrangler deploy --env prod
```

#### Important Notes for AI Agents
- Workers use `c.env` for environment variables, not `process.env`
- KV storage requires proper namespace bindings in `wrangler.jsonc`
- Secrets managed via `wrangler secret put`
- Use `@flaim/auth/*` imports for shared authentication logic

---

## Authentication & Security

### Clerk Authentication
- **Version**: Latest with 2025 MCP integration
- **Features**: SSO, Passkeys, Web3 auth, Multi-factor authentication
- **Security**: HttpOnly cookies, SameSite CSRF protection

#### Implementation Pattern
```typescript
// middleware.ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/settings(.*)'
]);

export default clerkMiddleware((auth, req) => {
  if (isProtectedRoute(req)) auth().protect();
});
```

#### Important Notes for AI Agents
- Use `clerkMiddleware()` in `middleware.ts` for route protection
- Wrap app with `ClerkProvider` in root layout
- Server-side auth integrates with Workers via JWT validation
- Pre-built components available for rapid development

### Credential Storage
- **Method**: AES-GCM encryption in Cloudflare KV
- **Key Management**: `CF_ENCRYPTION_KEY` environment variable
- **Access Pattern**: Centralized through `auth-worker`

---

## Model Context Protocol (MCP)

### Specification Version
- **Current**: June 18, 2025 specification
- **Key Updates**: Enhanced security, resource indicators, authorization patterns

### FLAIM MCP Architecture
```
Claude/AI Client
    ↓
auth-worker (credential management)
    ↓
sport-specific MCP servers
    ↓
ESPN API integration
```

#### MCP Server Capabilities
- **Tools**: Fantasy data retrieval functions
- **Resources**: League standings, rosters, matchups
- **Prompts**: Pre-defined fantasy analysis templates

#### Important Notes for AI Agents
- MCP servers are **stateless** - auth-worker handles all credentials
- Use stdio communication for local development
- HTTP+SSE for production deployment
- Follow June 2025 security patterns for authorization

---

## API Framework

### Hono Framework
- **Purpose**: Ultra-fast API framework for Cloudflare Workers
- **Performance**: Optimized for edge computing
- **Integration**: Native D1 and KV storage support

#### Development Pattern
```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('/*', cors());
app.get('/health', (c) => c.text('OK'));

app.get('/api/data', async (c) => {
  const data = await c.env.KV.get('key');
  return c.json({ data });
});

export default app;
```

#### Important Notes for AI Agents
- Use `c.env` for environment variables
- Built-in middleware for CORS, JWT, etc.
- TypeScript-first with excellent type safety
- Production-ready (used by Cloudflare internally)

---

## Package Management & Build

### NPM Workspace Configuration
- **Root**: Single `package.json` with workspace configuration
- **Structure**: Proper dependency hoisting
- **Imports**: Scoped `@flaim/auth/*` imports

#### Build Scripts
```bash
# Build all components
./build.sh

# Interactive deployment
./start.sh

# Development server
npm run dev
```

#### Important Notes for AI Agents
- Use workspace imports, not relative paths
- Build script handles all production artifacts
- Start script manages environment deployment

---

## Critical Development Guidelines

### For AI Agents Working on FLAIM

#### DO
- Use App Router patterns, not Pages Router
- Implement MCP servers as stateless functions
- Use `@flaim/auth/*` imports for shared code
- Follow three-environment deployment pattern
- Encrypt all credential storage with AES-GCM
- Use Hono for Worker APIs
- Follow June 2025 MCP security patterns

#### DON'T
- Use Node.js APIs in Workers (use Web Platform APIs)
- Store credentials in individual MCP servers
- Use `process.env` in Workers (use `c.env`)
- Implement auth logic in sport-specific workers
- Use Pages Router for new features
- Bypass the centralized auth-worker pattern

#### Common Patterns
```typescript
// Shared auth client usage
import { AuthWorkerClient } from '@flaim/auth/shared/auth-worker-client';

// Environment variable access in Workers
const apiKey = c.env.ESPN_API_KEY;

// KV storage with encryption
import { EspnKVStorage } from '@flaim/auth/espn/kv-storage';
```

---

## Documentation References

### Official Documentation
- **Next.js 15**: https://nextjs.org/docs/app
- **Cloudflare Workers**: https://developers.cloudflare.com/workers/
- **Clerk**: https://clerk.com/docs/quickstarts/nextjs
- **MCP**: https://modelcontextprotocol.io/specification/2025-06-18
- **Hono**: https://hono.dev/docs/getting-started/cloudflare-workers

### Internal Documentation
- **Architecture**: `/docs/ARCHITECTURE.md`
- **Deployment**: `/docs/DEPLOYMENT.md`
- **MCP Integration**: `/docs/dev/MCP_INTEGRATION.md`
- **Context7 Index**: `/docs/dev/CONTEXT7_DOCUMENTATION_INDEX.md`

---

## Version Compatibility Matrix

| Technology | Version | Status | Notes |
|------------|---------|---------|-------|
| Next.js | 15.x | Current | App Router, React 19 |
| React | 19.x RC | Current | Server Components |
| Cloudflare Workers | Latest | Current | Wrangler v4 |
| Clerk | 2025 | Current | MCP integration |
| MCP Spec | June 2025 | Current | Enhanced security |
| Hono | Latest | Current | Production ready |

---

## Future Considerations

### Upcoming Technologies
- **Cloudflare Containers**: Coming June 2025
- **OpenAI MCP Support**: Integrated March 2025
- **Google DeepMind MCP**: Confirmed April 2025

### Scalability Patterns
- Add new sport MCP servers following existing patterns
- Extend auth-worker for additional OAuth providers
- Implement caching layers for high-frequency data

### Security Enhancements
- Implement resource indicators per June 2025 MCP spec
- Enhanced token scoping for MCP servers
- Regular security audits of credential encryption

---

**Note for AI Agents**: This document represents the authoritative technology stack reference for FLAIM. Always verify current versions and check for updates when beginning new development work. The project follows enterprise-grade security practices and modern architectural patterns.