# FLAIM Platform Deployment Guide v4.0

## Platform Components

FLAIM consists of two main components:

1. **🤖 Next.js Frontend** (`/openai`) - *Main Application*
   - Clerk authentication
   - OpenAI chat interface
   - Usage tracking (15 free messages/month)
   - ESPN credential management

2. **⚾ Baseball ESPN MCP** (`/baseball-espn-mcp`) - *Open Access Service*
   - ESPN Fantasy Baseball integration
   - MCP protocol implementation
   - No authentication required


## Quick Start

### Prerequisites

1. **Clerk account** - Sign up at [clerk.com](https://clerk.com)
2. **OpenAI API key** - Get from [platform.openai.com](https://platform.openai.com)
3. **Cloudflare Workers account** - For MCP service hosting
4. **Node.js 18+** and npm

### Step 1: Set Up Clerk Authentication

1. Create a Clerk application at [clerk.com](https://clerk.com)
2. Get your publishable and secret keys
3. Configure authentication settings (email/password, social logins, etc.)

### Step 2: Deploy Baseball ESPN MCP Service

```bash
cd /flaim/baseball-espn-mcp

# Install dependencies
npm install

# Required: Set encryption key for ESPN credentials
wrangler secret put ENCRYPTION_KEY  # Generate: openssl rand -base64 32

# Required for production: Set Clerk secret for server-side verification
wrangler secret put CLERK_SECRET_KEY  # sk_test_... from Clerk dashboard

# Optional: Set ESPN credentials for development fallback (only works in development)
# wrangler secret put ESPN_S2      # For development testing only
# wrangler secret put ESPN_SWID    # For development testing only

# Deploy to production (NODE_ENV=production set via wrangler.toml)
wrangler deploy --env prod
```

### Step 3: Deploy Next.js Frontend

```bash
cd /flaim/openai

# Install dependencies
npm install

# Create environment file
cp .env.example .env.local

# Configure environment variables
# Edit .env.local with your keys:
OPENAI_API_KEY=sk-your-openai-api-key
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your-clerk-key
CLERK_SECRET_KEY=sk_test_your-clerk-secret
NEXT_PUBLIC_MCP_BASE_URL=https://your-mcp-service.workers.dev

# Build and start locally
npm run build
npm run start

# Or deploy to Vercel (recommended)
npx vercel deploy --prod
```

**Your FLAIM platform is now live!** 🎉

---

## Deployment Options

### Option A: Vercel + Cloudflare (Recommended)

**Frontend**: Deploy to Vercel for best Next.js experience
**MCP Service**: Deploy to Cloudflare Workers for global edge performance

```bash
# Frontend on Vercel
cd /flaim/openai
npx vercel deploy --prod

# MCP on Cloudflare
cd /flaim/baseball-espn-mcp
wrangler deploy --env prod
```

### Option B: All Cloudflare

Deploy both services to Cloudflare for unified management:

```bash
# MCP Service
cd /flaim/baseball-espn-mcp
wrangler deploy --env prod

# Frontend on Cloudflare Pages
cd /flaim/openai
npm run build
npx wrangler pages deploy out --project-name flaim-frontend
```

### Option C: Local Development

Run everything locally for development:

```bash
# Terminal 1: MCP Service
cd /flaim/baseball-espn-mcp
wrangler dev --env dev

# Terminal 2: Frontend
cd /flaim/openai
npm run dev
```

---

## Environment Configuration

### Required Environment Variables

#### Next.js Frontend (`.env.local`)
```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key-here

# Clerk Authentication (Required)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Optional Clerk Configuration
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

#### Baseball ESPN MCP (Cloudflare Workers)
```bash
# Required for all environments
ENCRYPTION_KEY=32-character-base64-encryption-key

# Required for production security (server-side Clerk verification)
CLERK_SECRET_KEY=sk_test_your-clerk-secret-key

# Environment configuration (set automatically via wrangler.toml)
NODE_ENV=production  # or "development"

# Optional development fallback (only works when NODE_ENV=development)
ESPN_S2=your-espn-s2-cookie-value
ESPN_SWID=your-espn-swid-cookie-value
```

### Setting Cloudflare Secrets

```bash
cd /flaim/baseball-espn-mcp

# Required: Set encryption key for ESPN credential storage
wrangler secret put ENCRYPTION_KEY
# Enter: (paste your 32-character base64 key from: openssl rand -base64 32)

# Required for production: Set Clerk secret for server-side verification
wrangler secret put CLERK_SECRET_KEY
# Enter: (paste your sk_test_... key from Clerk dashboard)

# Optional: ESPN credentials for development testing only
# (These only work when NODE_ENV=development)
wrangler secret put ESPN_S2
wrangler secret put ESPN_SWID
```

---

## User Experience & Features

### Authentication Flow

1. **New User Registration**:
   ```
   Visit FLAIM → See welcome screen → Click "Sign Up" 
   → Clerk registration → Account created → Start with 15 free messages
   ```

2. **Returning User**:
   ```
   Visit FLAIM → Automatic sign-in → See usage dashboard 
   → Continue conversations
   ```

### Usage Limits

- **Free Tier**: 15 AI messages per month
- **Paid Tier**: Unlimited AI messages (upgrade functionality included)
- **ESPN Features**: Available to all users (optional credential storage)

### ESPN Integration

Users can optionally store ESPN credentials for private league access:
1. Select "Baseball" + "ESPN" in tools panel
2. Enter ESPN S2 and SWID cookies
3. Credentials encrypted and stored per user
4. MCP tools can access private league data

---

## MCP Server Configuration

### For External AI Assistants

Configure external AI assistants (Claude Desktop, ChatGPT, etc.) to use the MCP server:

```json
{
  "type": "mcp",
  "server_label": "fantasy-baseball",
  "server_url": "https://your-mcp-service.workers.dev/mcp",
  "allowed_tools": [
    "get_espn_league_info",
    "get_espn_team_roster", 
    "get_espn_matchups"
  ],
  "require_approval": "never"
}
```

### Available MCP Tools

#### `get_espn_league_info`
Get league settings and metadata.
```json
{
  "name": "get_espn_league_info",
  "arguments": {
    "leagueId": "12345",
    "seasonId": "2024"
  }
}
```

#### `get_espn_team_roster`
Get detailed team roster information.
```json
{
  "name": "get_espn_team_roster", 
  "arguments": {
    "leagueId": "12345",
    "teamId": "1",
    "seasonId": "2024"
  }
}
```

#### `get_espn_matchups`
Get current week matchups.
```json
{
  "name": "get_espn_matchups",
  "arguments": {
    "leagueId": "12345",
    "week": 12,
    "seasonId": "2024"
  }
}
```

---

## Production Deployment Architecture

### High-Level Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Users         │    │   Next.js       │    │  Baseball ESPN  │
│                 │◄──►│   Frontend      │◄──►│     MCP         │
│ - Web browsers  │    │                 │    │                 │
│ - AI assistants │    │ - Clerk auth    │    │ - Open access   │
│ - Mobile apps   │    │ - Usage limits  │    │ - ESPN API      │
└─────────────────┘    │ - OpenAI chat   │    │ - MCP tools     │
                       └─────────────────┘    └─────────────────┘
                                │                       │
                       ┌────────▼────────┐     ┌────────▼────────┐
                       │   Clerk         │     │   Durable       │
                       │   Service       │     │   Objects       │
                       │ - User mgmt     │     │ - ESPN creds    │
                       │ - Sessions      │     │ - Encryption    │
                       └─────────────────┘     └─────────────────┘
```

### Service Responsibilities

**Next.js Frontend**:
- User authentication (Clerk)
- Usage tracking and limits
- OpenAI API integration
- ESPN credential management
- MCP client implementation

**Baseball ESPN MCP**:
- ESPN API integration
- MCP protocol implementation
- Credential storage (encrypted)
- Fantasy data retrieval

**Clerk Service** (External):
- User authentication
- Session management
- Account management
- Webhooks for user events

---

## Monitoring & Troubleshooting

### Health Checks

```bash
# Check MCP service
curl https://your-mcp-service.workers.dev/health

# Check frontend (if deployed)
curl https://your-frontend.vercel.app/api/usage
```

### Common Issues

**"Authentication required" errors**:
- Ensure Clerk keys are correctly configured
- Check that user is signed in
- Verify API routes have proper auth middleware

**"Usage limit exceeded"**:
- User has reached 15 free messages
- Upgrade functionality available in UI
- Usage resets monthly

**ESPN API errors**:
- Check if ESPN credentials are stored
- Verify credentials are not expired
- Public leagues don't require credentials

**MCP connection issues**:
- Verify MCP service is deployed and healthy
- Check MCP server URL configuration
- Ensure external AI assistant has correct config

### Viewing Logs

```bash
# Cloudflare Workers logs
wrangler tail fantasy-sports-mcp-prod

# Vercel logs (if using Vercel)
vercel logs your-deployment-url
```

---

## Security Features

### Authentication
- **Clerk Integration**: Industry-standard authentication
- **Session Management**: Secure, httpOnly sessions
- **Per-user Isolation**: Usage tracking per Clerk user ID

### Data Protection
- **ESPN Credential Encryption**: AES-GCM encryption in Durable Objects
- **API Protection**: All sensitive endpoints require authentication
- **Usage Limits**: Prevent abuse with free tier limits
- **CORS Configuration**: Restrict cross-origin access

### Best Practices
- Environment variables for all secrets
- Encrypted credential storage
- Short-lived sessions with automatic refresh
- Proper error handling and logging

---

## Scaling & Extensions

### Adding More Sports
Create additional MCP services:
```bash
# Clone ESPN MCP template
cp -r /flaim/baseball-espn-mcp /flaim/football-yahoo-mcp
# Modify for Yahoo Fantasy Football API
```

### Payment Integration
Integrate Stripe or other payment processors:
1. Set up payment webhooks
2. Update usage tracker to handle paid plans
3. Configure automatic upgrades/downgrades

### Database Migration
Replace in-memory usage tracking:
1. Add PostgreSQL/MySQL database
2. Update usage tracker to use persistent storage
3. Implement proper user data migration

---

## Support & Resources

- **Architecture Details**: See `ARCHITECTURE.md`
- **Getting Started**: See `GETTING_STARTED.md`
- **GitHub Issues**: Report bugs and feature requests
- **Clerk Documentation**: [clerk.com/docs](https://clerk.com/docs)
- **Cloudflare Workers**: [developers.cloudflare.com](https://developers.cloudflare.com)

---

## Migration from v3.0

If upgrading from previous versions:

1. **Replace auth service**: Remove custom JWT implementation
2. **Install Clerk**: Follow Clerk setup instructions
3. **Update frontend**: Migrate to new authentication flow
4. **Remove dependencies**: Clean up unused auth packages
5. **Test thoroughly**: Verify all features work with new auth

The v4.0 deployment is significantly simpler with better user experience and modern authentication practices.