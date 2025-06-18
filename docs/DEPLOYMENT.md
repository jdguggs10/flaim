# FLAIM Platform Deployment Guide v6.0

## 🚀 One-Click Deployment (Recommended)

### Local Development
```bash
git clone https://github.com/yourusername/flaim
cd flaim
./setup.sh              # One-time setup
./start-dev.sh          # Start all services
```

### Production Deployment
```bash
git clone https://github.com/yourusername/flaim  
cd flaim
./start-prod.sh         # Deploy to production
```

**Done!** The setup and deployment scripts handle all configuration, dependencies, secrets, and deployment automatically.

---

## Platform Components

FLAIM consists of three main components:

1. **🤖 Next.js Frontend** (`/openai`) - *Main Application*
   - Clerk authentication, OpenAI chat interface
   - Usage tracking (100 free messages/month)

2. **⚾ Baseball ESPN MCP** (`/workers/baseball-espn-mcp`) - *Open Access Service*
   - ESPN Fantasy Baseball integration (`baseball-espn-mcp`)

3. **🏈 Football ESPN MCP** (`/workers/football-espn-mcp`) - *Multi-Sport Extension*
   - ESPN Fantasy Football integration (`football-espn-mcp`)

## Manual Deployment (If Needed)

### Prerequisites
- **OpenAI API key** - Get from [platform.openai.com](https://platform.openai.com)
- **Cloudflare Workers account** - For MCP service hosting  
- **Cloudflare KV** - For encrypted credential storage (v6.0+)
- **Node.js 18+** and npm
- **Clerk already configured** (keys available)

### Manual Steps (if not using quickstart scripts)

#### 1. Setup CF KV Credential Storage (v6.0+)

FLAIM v6.0 introduces secure credential storage using Cloudflare KV with encryption:

```bash
# Create KV namespace for credential storage
wrangler kv:namespace create espn_credentials

# Note the namespace ID from output - add to wrangler.toml:
# [[kv_namespaces]]
# binding = "CF_KV_CREDENTIALS"
# id = "your-namespace-id-here"

# Generate encryption key
openssl rand -base64 32

# Set encryption key in CF Secrets (for workers)
wrangler secret put CF_ENCRYPTION_KEY
# Paste the base64 key when prompted

# For Next.js app, add to .env.local:
CF_ENCRYPTION_KEY=your-32-byte-base64-key
CF_KV_CREDENTIALS_NAMESPACE=espn_credentials
```

#### 2. Deploy Workers

```bash
# Deploy Baseball Worker with KV access
cd workers/baseball-espn-mcp
wrangler deploy --env prod

# Deploy Football Worker with KV access  
cd workers/football-espn-mcp
wrangler deploy --env prod
```

#### 3. Deploy Frontend

```bash
cd openai
npm run build
npx @cloudflare/next-on-pages  # Or deploy to Vercel
```

#### 4. Environment Configuration

Copy `ENV_SAMPLE` to `.env.local` and configure:

```bash
cp ENV_SAMPLE .env.local
```

Key variables for v6.0:
- `CF_KV_CREDENTIALS_NAMESPACE=espn_credentials`
- `CF_ENCRYPTION_KEY=your-base64-key`
- `BASEBALL_ESPN_MCP_URL=https://your-worker.workers.dev`
- `FOOTBALL_ESPN_MCP_URL=https://your-worker.workers.dev`

## 🔄 Migration from v5.x to v6.0

### Credential Storage Changes

v6.0 replaces Durable Object credential storage with CF KV + encryption:

**Before (v5.x):**
- Credentials stored in Durable Objects
- Auto league discovery via Gambit

**After (v6.0):**
- Credentials stored in encrypted CF KV
- Manual league entry + auto-pull team selection
- Up to 10 leagues per user

### Migration Steps

1. **Existing users**: Zustand store migration handles legacy data automatically
2. **New deployments**: Use CF KV setup above
3. **Legacy API**: Old `/api/onboarding/leagues` redirects with deprecation headers

### Breaking Changes

- Removed Gambit auto-discovery 
- New manual league entry flow
- CF KV required for credential storage
- Legacy Durable Object endpoints deprecated

### Development URLs (Local)
- Frontend: `http://localhost:3000`
- Baseball Worker: `http://localhost:8787`
- Football Worker: `http://localhost:8788`

---

## Environment Configuration

### 📄 Environment Files

The quickstart scripts use `.env.example` as a template. For manual setup:

#### Frontend (`.env.local`)
```bash
OPENAI_API_KEY=sk-your-openai-api-key-here
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

#### Worker Secrets (Both Workers)
```bash
ENCRYPTION_KEY=32-character-base64-key  # openssl rand -base64 32
CLERK_SECRET_KEY=sk_test_...           # Same as frontend
```

**Note**: Quickstart scripts handle all secret configuration automatically.

---

## Key Features

- **Free Tier**: 100 AI messages per month
- **ESPN Integration**: Private league access with encrypted credential storage
- **Multi-Sport**: Baseball and Football fantasy leagues
- **MCP Protocol**: External AI assistant compatibility

### Service URLs (After Deployment)
- **Baseball MCP**: `https://baseball-espn-mcp-prod.your-subdomain.workers.dev`
- **Football MCP**: `https://football-espn-mcp-prod.your-subdomain.workers.dev`
- **Frontend**: Check Cloudflare Pages dashboard

---

## Monitoring & Troubleshooting

### Health Checks
```bash
# Test worker health (URLs from production-info.md)
curl https://baseball-espn-mcp-prod.your-subdomain.workers.dev/health
curl https://football-espn-mcp-prod.your-subdomain.workers.dev/health
```

### Logs
```bash
wrangler tail baseball-espn-mcp-prod      # Baseball worker
wrangler tail football-espn-mcp-prod      # Football worker
```

### Common Issues
- **Usage limit exceeded**: User reached 100 free messages
- **ESPN API errors**: Check if credentials are stored/expired
- **MCP connection issues**: Verify worker URLs and health

---

## MCP Configuration for External AIs

### Baseball MCP Server
```json
{
  "type": "mcp",
  "server_label": "fantasy-baseball", 
  "server_url": "https://baseball-espn-mcp-prod.your-subdomain.workers.dev/mcp",
  "allowed_tools": ["get_espn_league_info", "get_espn_team_roster", "get_espn_matchups"],
  "require_approval": "never"
}
```

### Football MCP Server
```json
{
  "type": "mcp",
  "server_label": "fantasy-football",
  "server_url": "https://football-espn-mcp-prod.your-subdomain.workers.dev/mcp", 
  "allowed_tools": ["get_espn_football_league_info", "get_espn_football_team", "get_espn_football_matchups"],
  "require_approval": "never"
}
```

---

## Support & Resources

- **Setup & Deployment Scripts**: `./setup.sh` and `./start-prod.sh` 
- **Architecture Guide**: `./docs/ARCHITECTURE.md`
- **Getting Started**: `./docs/GETTING_STARTED.md`
- **Production Info**: `./production-info.md` (created after deployment)