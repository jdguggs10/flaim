# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FLAIM (Fantasy League AI Manager) v6.0 is a modern AI-powered fantasy sports assistant built as a microservices monorepo. The platform integrates ESPN fantasy sports through Model Context Protocol (MCP) workers and provides an intelligent chat interface with production-grade security and cross-platform authentication.

## Architecture

### Monorepo Structure
- **Root**: NPM workspace with dependency hoisting and shared TypeScript configs
- **`/auth`**: Cross-platform authentication module with platform-specific builds
- **`/openai`**: Next.js 15 frontend application (main user interface)
- **`/workers/`**: Cloudflare Workers implementing MCP protocol for sports integrations
- **`/tests`**: Comprehensive test suite with Jest and Playwright

### Key Technologies
- Next.js 15 with App Router
- Cloudflare Workers for serverless backend
- TypeScript throughout with path mapping (`@flaim/auth/*`)
- Clerk for authentication with server-side session verification
- OpenAI API integration for AI chat
- Cloudflare KV with AES-GCM encryption for credential storage (v6.0)
- Model Context Protocol (MCP) for AI tool integration

## Development Commands

### Quick Start
```bash
./start-dev.sh          # Start all services for development
./start-prod.sh         # One-click production deployment
```

### Development
```bash
./build-dev.sh          # Build all components for development
npm run dev             # Start Next.js frontend only (from /openai)
```

### Testing
```bash
npm run test            # Run comprehensive test suite
npm run test:unit       # Unit tests only
npm run test:e2e        # E2E tests with Playwright
npm run test:coverage   # Coverage report
```

### Individual Components
```bash
cd auth && npm run build                    # Build auth module
cd openai && npm run dev                    # Start frontend
cd workers/baseball-espn-mcp && wrangler dev --env dev --port 8787
cd workers/football-espn-mcp && wrangler dev --env dev --port 8788
```

### Linting & Type Checking
```bash
npm run lint            # From /openai directory
npm run type-check      # From /tests directory
```

## Build System

### Auth Module Build Targets
The auth module builds to multiple targets:
- `dist/shared/` - Core authentication logic
- `dist/workers/` - Cloudflare Workers builds
- `dist/web/` - Next.js/React builds

Use scoped imports: `@flaim/auth/shared/*`, `@flaim/auth/workers/*`, `@flaim/auth/web/*`

### Development vs Production
- **Development**: Local services with hot reloading, mock KV storage
- **Production**: Cloudflare Workers + Pages deployment, real KV with encryption

## Security Architecture

### Authentication Flow (v6.0)
1. Clerk handles user authentication with server-side session verification
2. User ID extracted from verified sessions (anti-spoofing protection)
3. ESPN credentials encrypted with AES-GCM and stored in Cloudflare KV
4. Key rotation support with keyId tracking in encrypted blobs
5. Usage tracking for tier-based access control

### Critical Security Features (Fixed in v4.0+)
- **CVE-2024-FLAIM-001 Fixed**: Header spoofing vulnerability eliminated
- **Server-side Clerk verification**: All credential endpoints verify session tokens
- **Anti-spoofing protection**: User ID never trusted from headers
- **Environment isolation**: Development fallbacks disabled in production
- **Encrypted storage**: 256-bit AES-GCM with random 96-bit IVs

### Credential Management (v6.0)
- ESPN credentials encrypted before storage in Cloudflare KV
- Encryption keys managed via Cloudflare Worker secrets
- Manual league entry with up to 10 leagues per user
- Auto-pull team setup for automatic team identification

## Worker Development

### MCP Protocol Implementation
Workers implement Model Context Protocol for AI tool integration:
- Health check endpoint: `/health`
- MCP endpoint: `/mcp`
- Credential management with encryption
- Auto-discovery of fantasy leagues

### Environment Setup
- Development: Mock credentials and KV storage
- Production: Real Cloudflare KV with encryption keys

## Testing Strategy

### Test Coverage Requirements
- Minimum 80% coverage for branches, functions, lines, statements
- Unit tests for core functionality
- Integration tests for API endpoints
- E2E tests with Playwright
- Deployment verification tests

### Test Organization
```
tests/
├── unit/           # Component and utility tests
├── integration/    # API and service integration
├── deployment/     # Infrastructure and deployment
└── e2e/           # End-to-end user flows
```

## Frontend Development

### Key Features (v6.0)
- **Streamlined 8-step onboarding**: Authentication → Platform → Credentials → Discovery → Selection → Auto-configuration → Chat
- **Usage-based access control**: 100 free messages/month (increased from 15)
- **Manual league entry**: Up to 10 leagues per user with auto-pull team setup
- **Multi-sport support**: Baseball, Football, Basketball, Hockey with auto-detection
- **Real-time AI chat**: OpenAI integration with context-aware responses
- **MCP integration**: Open access for external AI assistants (Claude Desktop, ChatGPT)
- **Responsive mobile-first design**: Progressive disclosure with clear error handling

### State Management
- Zustand for client state
- Server components for authenticated data
- Real-time usage tracking

## Common Development Patterns

### Adding New Sports Platforms
1. Create new worker in `/workers/[sport]-[platform]-mcp/`
2. Implement MCP protocol endpoints with health checks
3. Add AES-GCM encrypted credential storage
4. Update onboarding flow with sport auto-detection
5. Configure MCP tool auto-configuration
6. Add comprehensive tests with @miniflare/kv mocks

### Authentication Integration (v6.0 Security)
Always use server-side Clerk verification for sensitive operations:
```typescript
// Frontend API calls with Bearer tokens
import { useAuth } from '@clerk/nextjs'
const { getToken } = useAuth()
const token = await getToken()

// Server-side verification in workers
import { clerkClient } from '@clerk/backend'
const clerk = clerkClient({ secretKey: env.CLERK_SECRET_KEY })
const session = await clerk.sessions.verifySession(sessionToken)
```

### Credential Storage (v6.0)
Use encrypted Cloudflare KV:
```typescript
import { EspnStorage } from '@flaim/auth/workers/espn/storage'
const storage = new EspnStorage(env.CF_KV_CREDENTIALS, env.CF_ENCRYPTION_KEY)
```

### Worker Deployment
Use environment-specific configurations:
```bash
wrangler deploy --env dev    # Development
wrangler deploy --env prod   # Production
```

## Debugging

### Log Locations (Development)
- Baseball worker: `/tmp/baseball.log`
- Football worker: `/tmp/football.log`
- Frontend: `/tmp/frontend.log`

### Health Checks
```bash
curl http://localhost:8787/health    # Baseball worker
curl http://localhost:8788/health    # Football worker
curl http://localhost:3000           # Frontend
```

### Worker Logs (Production)
```bash
wrangler tail baseball-espn-mcp-prod
wrangler tail football-espn-mcp-prod
```

## Version History & Breaking Changes

### v6.0.0 (Current) - Major Infrastructure Overhaul
- **BREAKING**: CF KV replaces Durable Objects for credential storage
- **BREAKING**: Manual league entry replaces auto-discovery via Gambit
- **NEW**: AES-GCM encryption with key rotation support
- **NEW**: Manual league entry (up to 10 leagues per user)
- **FIXED**: Comprehensive test suite with @miniflare/kv mocks

### v4.0.0 - Critical Security Fix
- **SECURITY**: Fixed CVE-2024-FLAIM-001 header spoofing vulnerability
- **BREAKING**: Server-side Clerk verification required for all credential endpoints
- **BREAKING**: Development ESPN fallbacks disabled in production

### Migration Notes
- v6.0: Requires CF KV namespace and encryption key setup
- v4.0+: Requires CLERK_SECRET_KEY for production deployment
- See docs/DEPLOYMENT.md for detailed migration instructions

## Important Context

### Project Scope
This is an indie project built part-time with AI assistance (human-guided). The FAQ notes this directly, so set expectations appropriately when working on the codebase.

### Development Philosophy
- Security-first design with production-grade patterns
- Comprehensive testing with proper mocking
- Clear documentation and error handling
- Modern tooling and monorepo best practices