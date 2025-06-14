# FLAIM Workers

Cloudflare Workers for fantasy sports MCP integration with shared authentication.

## Structure

```
workers/
├── baseball-espn-mcp/          # ESPN Fantasy Baseball MCP server
│   ├── src/
│   │   ├── index.ts            # Main worker entry point
│   │   ├── espn.ts             # ESPN Baseball API client
│   │   ├── mcp/agent.ts        # MCP agent for baseball tools
│   │   ├── storage/            # User credential storage
│   │   ├── tools/              # Baseball-specific tools
│   │   └── types/              # Baseball API types
│   ├── package.json
│   ├── wrangler.toml
│   └── tsconfig.json
│
└── football-espn-mcp/          # ESPN Fantasy Football MCP server
    ├── src/
    │   ├── index.ts            # Main worker entry point
    │   ├── espn-football-client.ts # ESPN Football API client
    │   ├── mcp/football-agent.ts   # MCP agent for football tools
    │   └── types/              # Football API types
    ├── package.json
    ├── wrangler.toml
    └── tsconfig.json
```

## Shared Dependencies

Both workers use the shared authentication module:
- **`../auth/espn`** - ESPN credential management, storage, and MCP integration
- **`../auth/shared`** - Common encryption utilities

## Quick Start

### Baseball Worker
```bash
cd workers/baseball-espn-mcp
npm install
wrangler secret put ENCRYPTION_KEY
wrangler secret put CLERK_SECRET_KEY
wrangler deploy --env prod
```

### Football Worker
```bash
cd workers/football-espn-mcp
npm install
wrangler secret put ENCRYPTION_KEY
wrangler secret put CLERK_SECRET_KEY
wrangler deploy --env prod
```

## Available MCP Tools

### Baseball Tools
- `get_espn_league_info` - League settings and metadata
- `get_espn_team_roster` - Team roster details
- `get_espn_matchups` - Current week matchups

### Football Tools
- `get_espn_football_league_info` - League settings and metadata
- `get_espn_football_team` - Team roster and details
- `get_espn_football_matchups` - Weekly matchups and scores
- `get_espn_football_standings` - League standings

## Configuration

Both workers share the same authentication infrastructure:

- **Durable Objects**: `EspnStorage` from shared auth module
- **Encryption**: AES-GCM encryption for credential security
- **Authentication**: Clerk-based user verification
- **Fallback**: Development mode environment credentials

## Development

Each worker can be developed independently:
```bash
# Terminal 1: Baseball worker
cd workers/baseball-espn-mcp
wrangler dev --env dev

# Terminal 2: Football worker  
cd workers/football-espn-mcp
wrangler dev --env dev
```

## Architecture Benefits

- **Modularity**: Sport-specific workers with shared auth
- **Scalability**: Independent deployment and scaling
- **Maintainability**: Clear separation of concerns
- **Extensibility**: Easy to add more sports (basketball, hockey, etc.)
- **Security**: Centralized credential management with per-user encryption