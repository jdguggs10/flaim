# Football ESPN MCP Server

ESPN Fantasy Football MCP server with shared authentication via Supabase.

## Features

- **🏈 Fantasy Football Focus**: ESPN Fantasy Football specific API integration
- **🔐 Shared Authentication**: Uses auth-worker with Supabase for credential management
- **🛠️ MCP Tools**: Open access Model Context Protocol tools for external AI assistants
- **🌐 Serverless**: Cloudflare Workers deployment
- **⚡ Lightweight**: Focused specifically on football functionality

## Available MCP Tools

- `get_espn_football_league_info` - Get league settings and metadata
- `get_espn_football_team` - Get team roster and details
- `get_espn_football_matchups` - Get weekly matchups and scores
- `get_espn_football_standings` - Get league standings

## Quick Start

### 1. Install Dependencies
```bash
cd football-espn-mcp
npm install
```

### 2. Configure Environment
```bash
# Required for Clerk authentication verification (optional for dev)
wrangler secret put CLERK_SECRET_KEY --env preview
wrangler secret put CLERK_SECRET_KEY --env prod

# Set Supabase credentials as Cloudflare secrets
wrangler secret put SUPABASE_URL --env preview
wrangler secret put SUPABASE_SERVICE_KEY --env preview
wrangler secret put SUPABASE_URL --env prod  
wrangler secret put SUPABASE_SERVICE_KEY --env prod
```

**Note**: This worker depends on the auth-worker service for credential storage. The `AUTH_WORKER_URL` is configured in `wrangler.jsonc` for each environment. For local development, ensure the auth-worker is running on localhost:8786.

### 3. Deploy
```bash
# Development
wrangler deploy --env dev

# Production
wrangler deploy --env prod
```

## MCP Configuration

Configure external AI assistants to use this server:

```json
{
  "type": "mcp",
  "server_label": "fantasy-football",
  "server_url": "https://your-football-mcp-service.workers.dev/mcp",
  "allowed_tools": [
    "get_espn_football_league_info",
    "get_espn_football_team",
    "get_espn_football_matchups",
    "get_espn_football_standings"
  ],
  "require_approval": "never"
}
```

## Architecture

### Shared Authentication
- Uses auth-worker service with Supabase PostgreSQL for credential storage
- Stateless HTTP calls to auth-worker for credential retrieval
- Server-side Clerk verification for production security
- No client-side encryption complexity or eventual consistency issues

### Football-Specific Features
- ESPN Fantasy Football API endpoints (games/ffl)
- Football-specific data types and interfaces
- Season/week based data retrieval
- Team rosters, matchups, and standings

### Dependencies
- **auth-worker**: Centralized credential management with Supabase
- **Supabase**: PostgreSQL database for reliable credential storage
- **Clerk**: User authentication and authorization

## Endpoints

### MCP Endpoints (Open Access)
- `GET /mcp` - Server capabilities
- `GET /mcp/tools/list` - Available tools
- `POST /mcp/tools/call` - Execute tools

### Management Endpoints
- `GET /health` - Health check
- `POST /credential/espn` - Store ESPN credentials (auth required)

## Related Services

- **Baseball**: `baseball-espn-mcp` - ESPN Fantasy Baseball MCP server
- **Authentication**: `auth-worker` - Centralized credential management with Supabase
- **Frontend**: `flaim/openai` - Main application with auth UI