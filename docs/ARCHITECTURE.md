# FLAIM Platform Architecture v6.0

## Overview

FLAIM (Fantasy League AI Manager) is a **modern microservices platform** that provides AI-powered fantasy sports management through MCP (Model Context Protocol) tools. The architecture uses **Clerk authentication** for seamless user management with usage-based access controls.

## Architecture Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌───────────────────┐
│   Next.js       │    │   flaim/auth     │    │ workers/baseball  │
│   Frontend      │◄──►│   Module         │◄──►│     espn-mcp      │
│                 │    │                  │    │                   │
│ - React UI      │    │ - Cross-platform │    │ - ESPN API        │
│ - Auth module   │    │ - Usage tracking │    │ - Open access     │
│ - Usage limits  │    │ - Token mgmt     │    │ - MCP tools       │
│ - Chat interface│    │ - Clerk web impl │    │ - KV storage      │
└─────────────────┘    └──────────────────┘    └───────────────────┘
         │                       │                       │
         │              ┌────────▼────────┐              │
         │              │ Cloudflare KV   │              │
         │              │ (Encrypted      │              │
         │              │  ESPN Creds)    │              │
         │              │ 🔒 AES-GCM      │              │
         │              └─────────────────┘              │
         │                                               │
         └───────────────────────────────────────────────┘
                    Shared Authentication + Secure Storage
```

## Core Services

### 1. Next.js Frontend (`/openai`) - **Main Application**

**Purpose**: AI-powered fantasy sports assistant with modular authentication

**Responsibilities**:
- flaim/auth integration
- Usage tracking (100 free messages/month)
- OpenAI API integration
- MCP tools configuration
- Multi-sport support
- Responsive web interface

**Key Features**:
- **Free Tier**: 100 AI messages per month
- **Paid Tier**: Unlimited AI messages
- Real-time usage tracking
- Upgrade/downgrade functionality
- Cross-platform ready authentication

**API Endpoints**:
- `POST /api/turn_response` → OpenAI chat completion (auth required)
- `GET /api/usage` → Usage statistics (auth required)
- `POST /api/usage` → Plan management (auth required)
- `POST /api/vector_stores/*` → File management (auth required)

**Technology Stack**:
- [Next.js 15](https://nextjs.org/docs) (App Router)
- [React 19](https://react.dev/)
- [Clerk](https://clerk.com/docs) (Authentication)
- [OpenAI API](https://platform.openai.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [TypeScript](https://www.typescriptlang.org/docs/)
- [ESLint v9](https://eslint.org/docs/latest/) with [typescript-eslint v8](https://typescript-eslint.io/)

---

### 2. FLAIM Auth Module (`/auth`) - **Cross-Platform Authentication**

**Purpose**: Modular authentication system for web, iOS, and workers

**Responsibilities**:
- Cross-platform authentication interfaces
- Clerk web implementation
- Usage tracking and limits
- Token lifecycle management
- Environment-agnostic configuration

**Architecture**:
- `shared/` - Platform-agnostic core logic
- `clerk/web/` - Next.js/React implementation  
- `clerk/ios/` - Ready for Swift integration
- `dist/` - Built packages with separate targets

**Build Targets**:
- `dist/shared/` - Core authentication logic (platform-agnostic)
- `dist/workers/` - Cloudflare Workers-specific builds
- `dist/web/` - Next.js/React-specific builds

**Import Structure**:
```typescript
// Next.js Components
import { ClerkProvider, useAuth } from '@flaim/auth/web/components';

// API Routes  
import { withAuth, requireAuth } from '@flaim/auth/web/server';

// Middleware
import { clerkMiddleware } from '@flaim/auth/web/middleware';

// Workers
import { EspnStorage } from '@flaim/auth/workers/espn/storage';

// Shared Logic
import { UsageTracker } from '@flaim/auth/shared';
```

**Key Features**:
- **NPM workspace hoisting** eliminates dependency conflicts
- **Single Next.js instance** prevents type mismatches
- **Scoped imports** prevent brittle relative paths
- **Build target separation** avoids client/server conflicts
- **Type-safe auth wrappers** with explicit union return types
- **TypeScript path mapping** for automatic resolution
- **ESM-first** with Node.js compatibility
- Automated testing suite
- Token refresh handling
- Usage limit enforcement

---

## 🔒 Security Architecture (v6.0)

### Credential Storage
**CF KV with AES-GCM Encryption**:
- ESPN credentials encrypted before storage
- 256-bit AES-GCM with random 96-bit IVs
- Key rotation support with keyId tracking
- CF Secrets for encryption key management

### Runtime Security
**Workers-First Design**:
- KV namespace bindings in CF Workers (production)
- Mock KV for development/testing (Node.js)
- No credential decryption in browser/client-side
- API routes proxy to Workers for credential access

### Authentication Flow
1. User authenticates via Clerk
2. ESPN credentials captured and encrypted
3. Stored in CF KV with user ID as key
4. Workers decrypt credentials server-side for ESPN API calls
5. No credentials transmitted to client after initial setup

---

### 3. Baseball ESPN MCP (`/workers/baseball-espn-mcp`) - **Open Access Service**

**Purpose**: ESPN fantasy baseball integration with shared authentication

**Responsibilities**:
- Open access MCP endpoints
- Shared ESPN credential storage via flaim/auth
- **Automatic league discovery** via ESPN Fantasy v3 dashboard
- ESPN API integration
- Fantasy baseball data retrieval
- MCP protocol implementation

**Authentication Model**: **Shared Module**
- Uses flaim/auth for credential management
- MCP endpoints publicly accessible
- Clerk session verification for credentials

**Endpoints**:
- `GET /mcp` → MCP server info and capabilities
- `POST /mcp/tools/call` → Execute MCP tools
- `POST /credential/espn` → Store ESPN credentials (auth required)
- `GET /discover-leagues` → Automatic league discovery (auth required)
- `GET /health` → Service health check

**MCP Tools**:
- `get_espn_league_info` - League settings and metadata
- `get_espn_team_roster` - Team roster for scoring periods
- `get_espn_matchups` - Current week matchups

**Technology Stack**:
- Cloudflare Workers
- Durable Objects (credential storage)
- flaim/auth shared module
- TypeScript

---

### 4. Football ESPN MCP (`/workers/football-espn-mcp`) - **Multi-Sport Extension**

**Purpose**: ESPN fantasy football integration using shared authentication

**Responsibilities**:
- Sport-specific MCP tools for football
- Shared authentication infrastructure  
- ESPN football API integration
- Fantasy football data retrieval

**MCP Tools**:
- `get_espn_football_league_info` - League settings and metadata
- `get_espn_football_team` - Team roster and details
- `get_espn_football_matchups` - Weekly matchups and scores
- `get_espn_football_standings` - League standings

**Architecture Benefits**:
- Shared authentication with baseball worker
- Independent deployment and scaling
- Sport-specific customization
- Easy addition of new sports (basketball, hockey, etc.)
- @cloudflare/agents (MCP implementation)
- AES-GCM encryption (credential security)

---

---

## Authentication & Authorization

### Clerk Integration

FLAIM uses [Clerk](https://clerk.com/docs) for user authentication and management.

**Frontend Authentication** is handled by the `@clerk/nextjs` package, which provides components like `<ClerkProvider>`, `<SignInButton>`, `<SignUpButton>`, and `<UserButton>` for a seamless authentication experience.

```typescript
// middleware.ts
import { clerkMiddleware } from '@clerk/nextjs/server'
export default clerkMiddleware()

// layout.tsx
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";

<ClerkProvider>
  <SignedOut>
    <SignInButton />
    <SignUpButton />
  </SignedOut>
  <SignedIn>
    <UserButton />
  </SignedIn>
</ClerkProvider>
```

**Frontend API Calls** are authenticated using a JWT token obtained from the `useAuth` hook.

```typescript
import { useAuth } from '@clerk/nextjs'

const { getToken } = useAuth()
const token = await getToken()

fetch('/api/endpoint', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
```

**Server-Side Verification** in the MCP services is done using the `@clerk/backend` package, which verifies the session token.

```typescript
import { clerkClient } from '@clerk/backend'

async function verifyClerkSession(request: Request, env: Env) {
  const authHeader = request.headers.get('Authorization')
  const sessionToken = authHeader?.replace('Bearer ', '')
  
  if (!sessionToken) {
    return { userId: null, error: 'No session token found' }
  }

  const clerk = clerkClient({ secretKey: env.CLERK_SECRET_KEY })
  const session = await clerk.sessions.verifySession(sessionToken)
  
  return { userId: session.userId }
}
```

**API Protection** in the Next.js frontend is handled by the `auth` middleware from `@clerk/nextjs/server`.

```typescript
import { auth } from '@clerk/nextjs/server'

export async function POST(request: Request) {
  const { userId } = await auth()
  
  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }
  
  // Protected logic here
}
```

### Usage Tracking System

**Free Tier Limits**:
- 15 AI messages per month
- Automatic reset every 30 days
- Clear usage indicators in UI
- Upgrade prompts when approaching limits

**Paid Tier Benefits**:
- Unlimited AI messages
- All ESPN features
- Priority support

**Implementation**:
```typescript
class UsageTracker {
  static canSendMessage(userId: string): { allowed: boolean; remaining?: number }
  static incrementUsage(userId: string): UserUsage
  static upgradeToPaid(userId: string): UserUsage
}
```

## Security Model

### Production-Grade Security Features
- **Server-Side Clerk Verification**: All credential and discovery endpoints verify session tokens with Clerk backend
- **Anti-Spoofing Protection**: User ID extracted from verified session, never trusted from headers
- **Per-user Data Isolation**: Usage tracking per verified Clerk user ID
- **AES-GCM Encryption**: ESPN credentials encrypted in Durable Objects with key rotation planning
- **Environment Isolation**: Development fallbacks disabled in production
- **API Protection**: All sensitive endpoints require verified Clerk sessions
- **CORS Policies**: Restrict cross-origin access
- **Open MCP Access**: Baseball data freely accessible via MCP
- **Secure League Discovery**: ESPN Fantasy v3 calls use encrypted credentials with rate limiting
- **Comprehensive Error Handling**: User-friendly messages without exposing internals

### Secure Data Protection Flow
```
1. User signs in via Clerk → Gets session token
2. Frontend sends requests with Authorization: Bearer <token>
3. MCP service verifies token with Clerk backend API
4. Server extracts verified userId from session
5. ESPN credentials stored/retrieved using verified userId only
6. Usage tracking updated with verified user ID
7. MCP tools work without authentication for public data access
8. Premium features require valid verified Clerk session
```

### Security Hardening Features
- **No Header Spoofing**: Requests cannot fake user identity via headers
- **Production Environment Validation**: NODE_ENV checks prevent development shortcuts in production
- **Audit Logging**: Security events logged for monitoring and compliance
- **Session Validation**: Each credential request validates session server-side

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

### ESPN Credential Storage (Durable Objects)
```
1. User provides ESPN S2/SWID via frontend
2. Frontend sends to baseball-espn-mcp with user ID
3. Credentials encrypted (AES-GCM) → User's Durable Object
4. MCP tools decrypt credentials for ESPN API calls
```

## Environment Variables

### Next.js Frontend (Required)
```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Optional Clerk URLs
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

### Baseball ESPN MCP (Required)
```bash
# Required for all environments
ENCRYPTION_KEY=32-char-key-for-aes-encryption

# Required for production security
CLERK_SECRET_KEY=sk_test_your-clerk-secret-key

# Environment configuration (set via wrangler.toml)
NODE_ENV=production  # or "development"

# Optional development fallback (only works when NODE_ENV=development)
ESPN_S2=your-espn-s2-cookie
ESPN_SWID=your-espn-swid-cookie
```

## Deployment

The FLAIM frontend is deployed as a Next.js application to **Cloudflare Pages**, which provides a scalable, serverless environment with first-class support for Edge Functions.

The backend workers are deployed as **Cloudflare Workers**.

For complete, up-to-date instructions, please see the [**Deployment Guide**](./DEPLOYMENT.md).

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

✅ **Modern Authentication**: Clerk v2.1.0 with industry-standard auth  
✅ **True Monorepo**: NPM workspace with proper dependency hoisting  
✅ **Type Safety**: Explicit union types for all auth response shapes  
✅ **Single Dependencies**: No more duplicate Next.js or ESLint conflicts  
✅ **Modern Tooling**: ESLint v9 with typescript-eslint v8 compatibility  
✅ **Usage-Based Monetization**: Clear free/paid tiers  
✅ **Open MCP Access**: Fantasy data accessible without barriers  
✅ **Developer Friendly**: Simple setup and configuration  
✅ **Scalable**: Serverless architecture scales automatically  
✅ **User-Centric**: Smooth onboarding and upgrade flows  
✅ **Secure**: Encrypted data storage and session management  

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