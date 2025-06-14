# Football ESPN MCP Server

ESPN Fantasy Football MCP server with shared authentication from `flaim/auth/espn`.

## Features

- **🏈 Fantasy Football Focus**: ESPN Fantasy Football specific API integration
- **🔐 Shared Authentication**: Uses `flaim/auth/espn` for credential management
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

### 2. Set Required Secrets
```bash
# Required for credential encryption
wrangler secret put ENCRYPTION_KEY
# Enter: (32-character base64 key from: openssl rand -base64 32)

# Required for production security
wrangler secret put CLERK_SECRET_KEY
# Enter: (sk_test_... key from Clerk dashboard)
```

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
- Uses `flaim/auth/espn` for credential storage and management
- Supports both user-specific and development fallback credentials
- Server-side Clerk verification for production security

### Football-Specific Features
- ESPN Fantasy Football API endpoints (games/ffl)
- Football-specific data types and interfaces
- Season/week based data retrieval
- Team rosters, matchups, and standings

### Environment Support
- **Development**: Supports environment variable fallbacks
- **Production**: Requires user-specific ESPN credentials via Clerk auth

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
- **Authentication**: `flaim/auth/espn` - Shared ESPN credential management
- **Frontend**: `flaim/openai` - Main application with auth UI