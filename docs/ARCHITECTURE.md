# FLAIM Platform Architecture v6.0

## Overview

FLAIM (Fantasy League AI Manager) is a **modern microservices platform** that provides AI-powered fantasy sports management through MCP (Model Context Protocol) tools. The architecture uses **Clerk authentication** for seamless user management with usage-based access controls.

## Architecture Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌───────────────────┐
│   Next.js       │    │   auth-worker     │    │ workers/baseball  │
│   Frontend      │◄──►│   Module         │◄──►│     espn-mcp      │
│                 │    │                  │    │                   │
│ - React UI      │    │ - Cross-platform │    │ - ESPN API        │
│ - Auth module   │    │ - Usage tracking │    │ - Open access     │
│ - Usage limits  │    │ - Token mgmt     │    │ - MCP tools       │
│ - Chat interface│    │ - Clerk web impl │    │ - Supabase calls  │
└─────────────────┘    └──────────────────┘    └───────────────────┘
         │                       │                       │
         │              ┌────────▼────────┐              │
         │              │ Supabase        │              │
         │              │ PostgreSQL      │              │
         │              │ (ESPN Creds)    │              │
         │              │ 🔒 ACID         │              │
         │              └─────────────────┘              │
         │                                               │
         └───────────────────────────────────────────────┘
                    Shared Authentication + Secure Storage
```

## Core Services

### 1. Next.js Frontend (`/openai`) - **Main Application**

AI-powered fantasy sports assistant with auth-worker integration, usage tracking (100 free/unlimited paid messages), OpenAI API integration, and MCP tools configuration.

**Tech Stack**: Next.js 15, React 19, Clerk auth, OpenAI API, Tailwind CSS, TypeScript

---

### 2. FLAIM Auth Module (`/auth`) - **Cross-Platform Authentication**

Modular authentication system with cross-platform interfaces, Clerk implementation, usage tracking, and token management.

**Architecture**: `shared/` (core logic), `clerk/web/` (Next.js), `dist/` (build targets)

**Features**: NPM workspace hoisting, single Next.js instance, type-safe wrappers, ESM-first

---

## Security Architecture (v6.0)

### Credential Storage
**Supabase PostgreSQL Database**:
- ESPN credentials stored in structured relational tables
- ACID transaction guarantees eliminate eventual consistency issues
- Rich dashboard for visual data management and debugging
- Built-in backup and monitoring capabilities
- No client-side encryption complexity

### Runtime Security
**Auth-Worker Design**:
- Centralized credential management via auth-worker service
- Stateless HTTP calls from MCP workers to auth-worker
- No credential storage in individual MCP workers
- API routes proxy to auth-worker for credential access

### Authentication Flow
1. User authenticates via Clerk → JWT session token issued
2. ESPN credentials captured and validated
3. Stored in Supabase PostgreSQL via auth-worker service
4. Frontend obtains bearer token via `getToken()` and forwards to auth-worker
5. Auth-worker verifies JWT using JWKS before credential operations
6. MCP workers retrieve credentials via HTTP calls with forwarded tokens
7. No credentials transmitted to client after initial setup

---

### 3. Baseball ESPN MCP (`/workers/baseball-espn-mcp`) - **Open Access Service**

ESPN fantasy baseball integration with open MCP endpoints, auth-worker credential management, and automatic league discovery.

**MCP Tools**: `get_espn_league_info`, `get_espn_team_roster`, `get_espn_matchups`

**Tech Stack**: Cloudflare Workers, Supabase (via auth-worker), TypeScript

---

### 4. Football ESPN MCP (`/workers/football-espn-mcp`) - **Multi-Sport Extension**

ESPN fantasy football integration with sport-specific MCP tools and shared authentication.

**MCP Tools**: `get_espn_football_league_info`, `get_espn_football_team`, `get_espn_football_matchups`, `get_espn_football_standings`

**Benefits**: Independent deployment, sport-specific customization, framework for additional sports

---

---

## Authentication & Authorization

### Clerk Integration

FLAIM uses Clerk for user authentication with frontend components (`ClerkProvider`, `SignInButton`, `UserButton`), JWT token-based API calls, server-side session verification, and protected API routes.

### Usage Tracking System

**Free Tier**: 100 AI messages/month with automatic reset, usage indicators, upgrade prompts
**Paid Tier**: Unlimited messages, all features, priority support

## Security Model

### Production-Grade Security Features
- **JWKS-Based JWT Verification**: Auth-worker locally verifies Clerk JWTs using cached public keys (5min TTL)
- **Production Token Enforcement**: Production environments require valid bearer tokens, dev allows header fallback
- **Anti-Spoofing Protection**: User ID extracted from verified JWT `sub` claim, never trusted from headers
- **Centralized Security Model**: Only auth-worker verifies tokens, MCP workers forward Authorization headers
- **Per-user Data Isolation**: Usage tracking per verified Clerk user ID
- **Supabase Storage**: ESPN credentials stored in PostgreSQL with ACID guarantees
- **Environment Isolation**: Development fallbacks disabled in production
- **API Protection**: All sensitive endpoints require verified Clerk sessions
- **CORS Policies**: Restrict cross-origin access
- **Open MCP Access**: Public league data accessible without authentication
- **Secure League Discovery**: ESPN Fantasy v3 calls use authenticated credentials with rate limiting
- **Comprehensive Error Handling**: User-friendly messages without exposing internals

### Secure Data Protection Flow
```
1. User signs in via Clerk → Gets JWT session token
2. Frontend obtains bearer token via getToken() and sends requests with Authorization: Bearer <token>
3. Auth-worker verifies JWT locally using JWKS public keys (cached 5min)
4. Server extracts verified userId from JWT sub claim
5. ESPN credentials stored/retrieved using verified userId only
6. MCP workers forward Authorization header for credential requests
7. Usage tracking updated with verified user ID
8. MCP tools work without authentication for public data access
9. Premium features require valid verified Clerk session
```

### Security Hardening Features
- **No Header Spoofing**: Production rejects requests without valid JWT tokens, eliminating header-based attacks
- **Local JWT Verification**: Auth-worker verifies tokens using cached JWKS keys, avoiding remote API calls per request
- **Environment-Aware Security**: Production enforces JWT requirements, development allows header fallback for iteration
- **Centralized Verification**: Only auth-worker validates tokens, MCP workers remain stateless
- **Audit Logging**: Security events logged for monitoring and compliance
- **Session Validation**: Each credential request validates JWT signature and expiration

## Data Storage

### Usage Tracking (In-Memory/Database)
```typescript
interface UserUsage {
  userId: string;           // Clerk user ID
  messageCount: number;     // Messages sent this period
  resetDate: string;        // When usage resets
  plan: 'free' | 'paid';   // User's current plan
}
```

### ESPN Credential Storage (Supabase PostgreSQL)
```
1. User provides ESPN S2/SWID via frontend
2. Frontend sends to auth-worker with verified Clerk user ID
3. Credentials stored in Supabase PostgreSQL via auth-worker
4. MCP workers retrieve credentials via HTTP calls to auth-worker
```

## Environment Variables

The platform requires environment variables for OpenAI API, Clerk authentication, Supabase integration, and service communication. 

**For complete environment variable setup and configuration, see [Getting Started Guide](./GETTING_STARTED.md#complete-environment-variable-reference).**

## Deployment

The FLAIM frontend is deployed as a Next.js application to **Vercel**, which provides zero-configuration deployment, automatic previews, and native Next.js support.

The backend workers are deployed as **Cloudflare Workers**.

For complete, up-to-date instructions, please see the [**Getting Started Guide**](./GETTING_STARTED.md).

## MCP Integration

### Tool Configuration in Frontend
```typescript
const mcpTool = {
  type: "mcp",
  server_label: "fantasy-baseball",
  server_url: "https://baseball-espn-mcp.your-domain.workers.dev/mcp",
  allowed_tools: ["get_espn_league_info", "get_espn_team_roster", "get_espn_matchups"],
  require_approval: "never"
}
```

### Available Tools
- `get_espn_league_info(leagueId, seasonId?)` - League settings and metadata
- `get_espn_team_roster(leagueId, teamId, seasonId?)` - Team roster details
- `get_espn_matchups(leagueId, week?, seasonId?)` - Current week matchups

## User Experience Flow

### New User Journey
```
1. Visit FLAIM application
2. See welcome screen with authentication prompt
3. Click "Sign Up" → Clerk registration flow
4. Account created → redirect to main app
5. Start with 15 free messages
6. Configure ESPN credentials for private leagues
7. Use AI assistant for fantasy sports help
```

### Returning User Experience
```
1. Visit FLAIM application
2. Automatic sign-in via Clerk session
3. See usage dashboard (messages remaining)
4. Continue conversations
5. Upgrade prompt when approaching limits
```

## Monitoring & Health Checks

### Health Endpoints
- `GET /health` on baseball-espn-mcp
- `GET /api/usage` for usage statistics
- Clerk dashboard for authentication metrics
- Cloudflare Analytics for MCP service usage

### Error Handling
- Graceful authentication errors
- Usage limit notifications
- ESPN API error translation
- Proper error boundaries in React

## Extensibility

### Additional Sports Platforms
```
/flaim/yahoo-mcp        # Yahoo fantasy integration
/flaim/nfl-mcp          # NFL-specific tools  
/flaim/basketball-mcp   # NBA fantasy tools
```

### Payment Integration
- Clerk webhooks for subscription events
- Stripe integration for plan upgrades
- Automatic usage tier management

---

## Benefits of v5.0 Architecture  

## Migration from v4.0

Key improvements in v5.0:
- **True NPM workspace** with root package.json dependency hoisting
- **Single Next.js installation** eliminates type conflicts permanently
- **ESLint v9 upgrade** with typescript-eslint v8 for modern linting
- **Type-safe auth wrappers** with explicit union return types
- **Clerk v2.1.0 upgrade** for latest authentication features
- **Eliminated symlink hacks** through proper monorepo structure
- **Resolved build issues** from duplicate dependency conflicts

The v5.0 architecture provides a rock-solid monorepo foundation for scaling FLAIM with no dependency conflicts and full type safety.