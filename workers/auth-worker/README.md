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
- `POST /leagues/add` - Store a single ESPN league (season-aware)
- `GET /leagues` - Get ESPN leagues
- `DELETE /leagues` - Remove all seasons for a league
- `PATCH /leagues/:leagueId/team` - Update team selection

## Supported Platforms

- `espn` - ESPN Fantasy credentials (swid, s2)

## Authentication

Authorization required (Clerk JWT or OAuth access token).

## Setup

### 1. Create Supabase Project
- Go to https://supabase.com/dashboard
- Create new project and note the project URL
- Run the migrations from `docs/migrations/` in order (001 through 007)

### 2. Configure Cloudflare Secrets
```bash
# Set Supabase credentials as Cloudflare secrets for each environment
wrangler secret put SUPABASE_URL --env preview
wrangler secret put SUPABASE_SERVICE_KEY --env preview

wrangler secret put SUPABASE_URL --env prod  
wrangler secret put SUPABASE_SERVICE_KEY --env prod
```

### 3. Local Development
Create `.dev.vars` in the `workers/auth-worker` directory:
```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```
Note: Wrangler reads `.dev.vars` automatically during `wrangler dev`.

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
- `SUPABASE_SERVICE_KEY` - Supabase Secret Key (sb_secret_...) (set via wrangler secret)
- `NODE_ENV` - Environment (development/production)

## Supabase Integration

This implementation uses Supabase PostgreSQL for reliable credential storage:
- ✅ ACID compliance (no eventual consistency issues)
- ✅ Rich dashboard for data management and debugging
- ✅ No client-side encryption complexity
- ✅ Structured relational data with foreign keys
- ✅ Built-in backup and monitoring capabilities

## League Storage Notes

- Leagues are stored per season year; `(user, sport, leagueId, seasonYear)` is unique.
- Deleting a league removes all seasons for that league (no per-season delete).
