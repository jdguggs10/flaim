# FLAIM Platform Architecture

## Overview

FLAIM (Fantasy League AI Manager) uses a **microservices architecture** with **Stripe-first authentication**. The platform separates concerns into distinct services that communicate via JWT tokens.

## Architecture Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌───────────────────┐
│   OpenAI        │    │   flaim-auth     │    │  baseball-espn-   │
│   Frontend      │◄──►│   Service        │◄──►│     mcp           │
│                 │    │                  │    │                   │
│ - Claude.ai UI  │    │ - Stripe         │    │ - ESPN API        │
│ - MCP tools     │    │ - JWT minting    │    │ - JWT validation  │
│ - Chat interface│    │ - Subscription   │    │ - MCP tools       │
└─────────────────┘    └──────────────────┘    └───────────────────┘
         │                       │                       │
         │              ┌────────▼────────┐              │
         │              │     Stripe      │              │
         │              │   Dashboard     │              │
         │              └─────────────────┘              │
         │                                               │
         └───────────────────────────────────────────────┘
                      JWT Bearer Token Flow
```

## Service Breakdown

### 1. Auth Service (`/flaim/auth`)

**Purpose**: Central authentication gateway for the entire platform

**Responsibilities**:
- Stripe Checkout session creation
- Subscription validation  
- JWT token minting (15-minute expiry)
- Webhook handling for subscription updates
- User session management

**Endpoints**:
- `GET /login` → Stripe checkout page
- `GET /checkout` → Create Stripe session
- `GET /callback` → Handle payment completion
- `POST /webhook/stripe` → Subscription updates
- `POST /validate` → JWT validation for services

**Technology Stack**:
- Cloudflare Workers
- Stripe API
- JOSE (JWT signing/verification)
- KV storage for subscription cache

---

### 2. Baseball ESPN MCP (`/flaim/baseball-espn-mcp`)

**Purpose**: ESPN fantasy baseball integration with MCP tools

**Responsibilities**:
- JWT validation (shared secret with auth service)
- ESPN S2/SWID credential storage (encrypted)
- MCP protocol implementation
- ESPN API integration
- Fantasy baseball data retrieval

**Endpoints**:
- `GET /mcp` → MCP server info
- `POST /mcp/tools/call` → Execute MCP tools
- `POST /credential/espn` → Store ESPN credentials
- `GET /health` → Service health check

**Technology Stack**:
- Cloudflare Workers
- Durable Objects (user credential storage)
- @cloudflare/agents (MCP implementation)
- JOSE (JWT validation only)
- AES-GCM encryption

---

### 3. OpenAI Frontend (`/flaim/openai`)

**Purpose**: AI assistant interface with fantasy sports integration

**Responsibilities**:
- Claude.ai/ChatGPT integration
- MCP tools configuration
- User interface for fantasy management
- File upload and vector stores
- AI conversation flow

**Technology Stack**:
- Next.js 14
- React components
- OpenAI API integration
- MCP client implementation

---

## Authentication Flow

### 1. Initial Login
```
User → GET /login (auth service)
     → Stripe Checkout
     → Payment completion
     → POST /callback (auth service)
     → JWT minted (15 min expiry)
     → Redirect to OpenAI frontend
```

### 2. Service Access
```
Frontend → Bearer JWT → baseball-espn-mcp
        → JWT validation → ESPN data
        → MCP tools response
```

### 3. Subscription Management
```
Stripe → Webhook → /webhook/stripe (auth service)
      → KV cache update
      → Service access control
```

## Security Model

### JWT Structure
```json
{
  "sub": "cus_stripe_customer_id",
  "email": "user@example.com", 
  "plan": "pro",
  "exp": 1640995200,
  "iat": 1640994300,
  "iss": "flaim-auth",
  "aud": "flaim-platform"
}
```

### Key Security Features
- **Short-lived JWTs** (15 minutes) prevent long-term compromise
- **Audience validation** (`flaim-platform`) ensures tokens are platform-specific
- **Stripe webhook verification** with HMAC-SHA256
- **AES-GCM encryption** for ESPN credentials
- **Per-user Durable Objects** provide data isolation
- **CORS policies** restrict cross-origin access

## Data Flow

### ESPN Credential Storage
```
1. User authenticated via Stripe → JWT
2. Frontend sends ESPN S2/SWID → baseball-espn-mcp
3. JWT validated → User ID extracted
4. Credentials encrypted (AES-GCM) → Durable Object
5. MCP tools decrypt credentials → ESPN API calls
```

### Subscription Verification
```
1. Stripe webhook → auth service
2. Subscription status → KV cache
3. JWT validation checks cache
4. Service access granted/denied
```

## Environment Variables

### Auth Service
```bash
STRIPE_API_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
JWT_SECRET=your-strong-secret
```

### Baseball ESPN MCP
```bash
JWT_SECRET=same-as-auth-service
ENCRYPTION_KEY=32-char-key-for-aes
```

## Deployment Strategy

### Development
```bash
# Deploy auth service
cd /flaim/auth
wrangler deploy --env dev

# Deploy ESPN MCP
cd /flaim/baseball-espn-mcp  
wrangler deploy --env dev

# Deploy frontend
cd /flaim/openai
npm run build && npm run deploy
```

### Production
- **Auth Service**: `auth.flaim.app`
- **ESPN MCP**: `baseball-mcp.flaim.app`
- **Frontend**: `app.flaim.app`

## Monitoring & Observability

### Health Checks
- `GET /health` on each service
- Cloudflare Analytics dashboard
- Stripe webhook delivery monitoring

### Error Handling
- Structured error responses
- Service-specific error codes
- Cloudflare Workers error logging

## Future Extensibility

### Additional Sports Platforms
```
/flaim/yahoo-mcp      # Yahoo fantasy integration
/flaim/nfl-mcp        # NFL-specific tools
/flaim/basketball-mcp # NBA fantasy tools
```

### Additional Auth Providers
- GitHub OAuth (for developer features)
- Google SSO (for consumer convenience)
- Apple Sign-In (mobile apps)

### Scaling Considerations
- **Horizontal**: Multiple regional deployments
- **Vertical**: Durable Object limits and KV quotas
- **Caching**: CDN for static assets, Redis for session data

---

## Benefits of This Architecture

✅ **Separation of Concerns**: Auth, ESPN, and frontend are independent
✅ **Scalability**: Services can scale independently  
✅ **Security**: Centralized auth with distributed validation
✅ **Maintainability**: Clear service boundaries
✅ **Extensibility**: Easy to add Yahoo, NFL, etc.
✅ **Cost Efficiency**: Pay only for what you use (Cloudflare Workers)

This architecture provides enterprise-grade security while maintaining developer productivity and platform flexibility.