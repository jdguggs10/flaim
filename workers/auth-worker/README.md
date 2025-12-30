# Auth Worker

Supabase-based credential storage worker for Flaim.

## Overview

The Auth Worker is a centralized Cloudflare Worker responsible for storing, retrieving, and managing user ESPN credentials with Supabase PostgreSQL storage.

## Endpoints

- `GET /health` - Health check with Supabase connectivity test
- `POST /credentials/espn` - Store ESPN credentials
- `GET /credentials/espn` - Get ESPN credential metadata
- `DELETE /credentials/espn` - Delete ESPN credentials
- `GET /credentials/espn?raw=true` - Get raw credentials for MCP workers
- `POST /leagues` - Store ESPN leagues
- `GET /leagues` - Get ESPN leagues
- `DELETE /leagues` - Remove specific league
- `PATCH /leagues/:leagueId/team` - Update team selection

## Supported Platforms

- `espn` - ESPN Fantasy credentials (swid, s2)

## Authentication

All credential endpoints require the `X-Clerk-User-ID` header containing the Clerk user ID.

## Setup

### 1. Create Supabase Project
- Go to https://supabase.com/dashboard
- Create new project and note the project URL
- Create new project and note the project URL
- Run the database schema from `docs/SUPABASE_SETUP.md`

### 2. Configure Cloudflare Secrets
```bash
# Set Supabase credentials as Cloudflare secrets for each environment
wrangler secret put SUPABASE_URL --env preview
wrangler secret put SUPABASE_SERVICE_KEY --env preview

wrangler secret put SUPABASE_URL --env prod  
wrangler secret put SUPABASE_SERVICE_KEY --env prod
```

### 3. Local Development
Create `.env.local` in the `web` directory:
```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

## Development

```bash
# Start development server
npm run dev

# Type check
npx tsc --noEmit

# Run tests (manual with Supabase credentials)
npx tsx src/test-supabase.ts

# Deploy
npm run deploy
```

## Environment Variables

- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Supabase Secret Key (sb_secret_...) (set via wrangler secret)
- `NODE_ENV` - Environment (development/production)

## Supabase Integration

This implementation uses Supabase PostgreSQL for reliable credential storage:
- ✅ ACID compliance (no eventual consistency issues)
- ✅ Rich dashboard for data management and debugging
- ✅ No client-side encryption complexity
- ✅ Structured relational data with foreign keys
- ✅ Built-in backup and monitoring capabilities