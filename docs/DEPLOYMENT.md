# FLAIM Platform Deployment Guide v6.0

## 🚀 Interactive Deployment (Recommended)

### One-Command Flexible Setup
```bash
git clone https://github.com/yourusername/flaim
cd flaim
./setup.sh              # One-time setup
./start.sh              # Interactive deployment wizard
```

The interactive launcher lets you choose how each worker runs:
- **Local dev**: Traditional local development with health checks
- **Remote preview**: Wrangler remote development with live URLs  
- **Deploy preview**: Deploy to Cloudflare preview environment
- **Deploy production**: Deploy to Cloudflare production
- **Skip**: Disable specific workers

### Legacy Quick Deployment
```bash
git clone https://github.com/yourusername/flaim  
cd flaim
./start-prod.sh         # Deploy everything to production
```

**Ready in minutes!** The interactive launcher provides maximum flexibility for development and deployment scenarios.

## 🔨 Production Build Script

### Overview

The `build.sh` script provides a consolidated build process for creating production-ready artifacts:

```bash
./build.sh              # Interactive build menu
./build.sh --prod       # Non-interactive production build (for CI)
```

### What It Does

1. **Builds auth module**: Compiles shared authentication library with scoped imports
2. **Builds Next.js frontend**: Creates optimized production build
3. **Type-checks workers**: Validates TypeScript without compilation (workers transpile on-the-fly)
4. **Fail-fast behavior**: Stops on first error for reliable CI/CD

### Build Order

The script follows a deterministic build sequence:
```
auth module → Next.js frontend → worker type-checks
```

### When to Use

| Scenario | Command | Purpose |
|----------|---------|---------|
| **CI/CD Pipeline** | `./build.sh --prod` | Non-interactive, fails fast |
| **Pre-deployment** | `./build.sh` | Interactive, catch errors early |
| **Local development** | Not needed | Dev servers transpile on-the-fly |

### Output

After successful completion:
- `auth/dist/` - Compiled authentication module
- `openai/.next/` - Next.js production build  
- All workers type-checked and ready for deployment

## 🎯 Interactive Launcher Guide

### How It Works

The `start.sh` script prompts you to configure each worker individually:

```
▶  How should the auth worker run?
    1) Local dev          (wrangler dev --port)
    2) Remote preview     (wrangler dev --remote)
    3) Deploy  preview    (wrangler deploy --env preview)
    4) Deploy  prod       (wrangler deploy --env prod)
    0) Skip
    Select [1-4/0, default 1]:
```

### Deployment Modes Explained

| Mode | Description | Use Case | Environment Variables |
|------|-------------|----------|----------------------|
| **Local dev** | `wrangler dev --port` | Traditional development | Uses localhost URLs |
| **Remote preview** | `wrangler dev --remote` | Testing with live URLs | Auto-captures remote URLs |
| **Deploy preview** | `wrangler deploy --env preview` | Staging environment | Uses preview URLs |
| **Deploy prod** | `wrangler deploy --env prod` | Production deployment | Uses production URLs |
| **Skip** | Disabled | Minimal setups | No environment variables |

### Environment Variable Management

The launcher automatically manages `NEXT_PUBLIC_*` environment variables:

- **Local mode**: Cleans up remote URLs, uses `localhost`
- **Remote mode**: Captures live URLs from wrangler logs (60s timeout + manual fallback)
- **Deploy modes**: Constructs URLs using `CF_ACCOUNT_ID`

### Prerequisites for Deployment

```bash
# Required for deploy modes (preview/prod)
export CF_ACCOUNT_ID=your-account-id    # Get from: wrangler whoami

# Configure secrets for workers you're deploying
cd workers/auth-worker
wrangler secret put ENCRYPTION_KEY      # Generate: openssl rand -base64 32
wrangler secret put CLERK_SECRET_KEY    # From Clerk dashboard
```

### Common Scenarios

**Full Local Development:**
```
auth: 1 (Local dev)
baseball: 1 (Local dev)  
football: 1 (Local dev)
```

**Hybrid Development:**
```
auth: 1 (Local dev)           # Debug authentication locally
baseball: 2 (Remote preview)  # Test with live MLB data
football: 0 (Skip)            # Focus on baseball only
```

**Production Deployment:**
```
auth: 4 (Deploy prod)
baseball: 4 (Deploy prod)
football: 4 (Deploy prod)
```

**Staging Testing:**
```
auth: 3 (Deploy preview)
baseball: 3 (Deploy preview)
football: 0 (Skip)
```

### Troubleshooting

**CF_ACCOUNT_ID Missing:**
```
❌  Error: CF_ACCOUNT_ID environment variable is required for deployment
    Please set it with: export CF_ACCOUNT_ID=your-account-id
    Or run: wrangler whoami to see your account ID
```

**Remote URL Capture Timeout:**
```
⚠️  Could not auto-capture remote URL for auth worker after 60s
📋 Please check the log file and enter the URL manually:
   tail -f /tmp/auth.log

Enter the remote URL (or press Enter to skip):
```

**Environment Cleanup:**
- Local mode automatically cleans up `NEXT_PUBLIC_*` variables
- Prevents conflicts when switching between modes in the same terminal

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

FLAIM v6.0 introduces secure credential storage using Cloudflare KV with encryption.

**Quick Setup:**
```bash
# Follow the complete setup guide
see docs/dev/KV_SETUP.md
```

**Summary:**
1. Create KV namespace: `wrangler kv:namespace create espn_credentials`
2. Update both workers' wrangler.toml with namespace IDs
3. Generate encryption key: `openssl rand -base64 32`
4. Set secrets in both workers: `wrangler secret put CF_ENCRYPTION_KEY`
5. Add key to Next.js .env.local: `CF_ENCRYPTION_KEY=your-key`

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
- `CF_ENCRYPTION_KEY=your-base64-key` (REQUIRED)
- `NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL=https://your-worker.workers.dev` (optional)
- `NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL=https://your-worker.workers.dev` (optional)

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
CF_ENCRYPTION_KEY=32-character-base64-key  # openssl rand -base64 32
CLERK_SECRET_KEY=sk_test_...              # Same as frontend
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