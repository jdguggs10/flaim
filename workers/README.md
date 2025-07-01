# FLAIM Workers

Cloudflare Workers providing **Model Context Protocol (MCP)** servers for fantasy sports data integration with centralized auth-worker credential management.

## Structure

```
workers/
├── auth-worker/                # Centralized credential management
│   ├── src/
│   │   ├── index.ts            # Auth API endpoints
│   │   ├── storage/            # KV credential encryption
│   │   └── types/              # Auth API types
│   ├── package.json
│   ├── wrangler.toml
│   └── tsconfig.json
│
├── baseball-espn-mcp/          # ESPN Fantasy Baseball MCP server
│   ├── src/
│   │   ├── index.ts            # MCP server endpoints
│   │   ├── espn.ts             # ESPN Baseball API client
│   │   ├── mcp/agent.ts        # MCP protocol implementation
│   │   ├── tools/              # Baseball-specific MCP tools
│   │   └── types/              # Baseball API types
│   ├── package.json
│   ├── wrangler.toml
│   └── tsconfig.json
│
└── football-espn-mcp/          # ESPN Fantasy Football MCP server
    ├── src/
    │   ├── index.ts            # MCP server endpoints
    │   ├── espn-football-client.ts # ESPN Football API client
    │   ├── mcp/football-agent.ts   # MCP protocol implementation
    │   ├── tools/              # Football-specific MCP tools
    │   └── types/              # Football API types
    ├── package.json
    ├── wrangler.toml
    └── tsconfig.json
```

## Architecture & Dependencies

### Auth-Worker Centralization
All ESPN credential management is centralized through the dedicated **auth-worker**:
- **Credential Storage**: AES-GCM encrypted storage in Cloudflare KV
- **User Authentication**: Clerk-based verification with `X-Clerk-User-ID` headers
- **API Endpoints**: `/credentials/espn` for credential CRUD operations
- **League Management**: `/leagues` endpoints for user league associations

### MCP Integration
Both sport workers integrate with the **Model Context Protocol**:
- **`@flaim/auth/espn`** - Shared ESPN credential management and MCP utilities
- **`@flaim/auth/shared`** - Common encryption and authentication patterns
- **Auth-worker Communication**: Internal API calls to retrieve user credentials

## Quick Start

### Auth Worker (Required First)
```bash
cd workers/auth-worker
npm install
wrangler secret put ENCRYPTION_KEY
wrangler secret put CLERK_SECRET_KEY
wrangler kv:namespace create CF_KV_CREDENTIALS
wrangler deploy --env prod
```

### Baseball MCP Worker
```bash
cd workers/baseball-espn-mcp
npm install
wrangler secret put AUTH_WORKER_URL  # URL of deployed auth-worker
wrangler deploy --env prod
```

### Football MCP Worker
```bash
cd workers/football-espn-mcp  
npm install
wrangler secret put AUTH_WORKER_URL  # URL of deployed auth-worker
wrangler deploy --env prod
```

## Available MCP Tools

### Baseball MCP Tools (`/workers/baseball-espn-mcp/`)
- **`get_espn_league_info`** - League settings, standings, and metadata
- **`get_espn_team_roster`** - Detailed team roster information
- **`get_espn_matchups`** - Current week matchups and scores

### Football MCP Tools (`/workers/football-espn-mcp/`)
- **`get_espn_football_league_info`** - League settings and metadata  
- **`get_espn_football_team`** - Team roster and details
- **`get_espn_football_matchups`** - Weekly matchups and scores
- **`get_espn_football_standings`** - League standings and rankings

### MCP Protocol Endpoints
Both workers implement standard MCP endpoints:
- **`GET /mcp`** - Server capabilities and metadata
- **`GET /mcp/tools/list`** - Available tools with schemas
- **`POST /mcp/tools/call`** - Execute MCP tools with arguments

## Configuration & Integration

### Auth-Worker Integration
Both MCP workers communicate with the centralized auth-worker:
- **Credential Retrieval**: `GET /credentials/espn` via internal API calls
- **League Management**: `GET /leagues` for user league associations
- **User Context**: `X-Clerk-User-ID` header for user identification
- **Secure Communication**: Internal worker-to-worker authentication

### MCP Client Configuration
Configure AI assistants to use these MCP servers:
```json
{
  "server_label": "flaim-baseball",
  "server_url": "https://baseball-espn-mcp.your-account.workers.dev/mcp",
  "allowed_tools": "get_espn_league_info,get_espn_team_roster,get_espn_matchups",
  "skip_approval": false
}
```

### Environment Variables
- **Production**: All credentials managed through Cloudflare Workers secrets
- **Development**: Fallback to local environment variables for testing

## Development

Multi-worker development setup:
```bash
# Terminal 1: Auth worker (required for credential management)
cd workers/auth-worker
wrangler dev --env dev

# Terminal 2: Baseball MCP worker
cd workers/baseball-espn-mcp
wrangler dev --env dev

# Terminal 3: Football MCP worker  
cd workers/football-espn-mcp
wrangler dev --env dev
```

## Architecture Benefits

- **MCP Standardization**: Standardized protocol for AI tool integration
- **Centralized Authentication**: Single auth-worker handles all credential management
- **Modular Sports**: Each sport has dedicated MCP server with specialized tools
- **Real-time Data**: Live ESPN fantasy data accessible via MCP protocol
- **Scalability**: Independent deployment and scaling per sport
- **Security**: AES-GCM encrypted credential storage with user isolation
- **Extensibility**: Easy to add more sports (basketball, hockey, soccer, etc.)
- **AI Integration**: Direct Claude access to user's fantasy league data