# Baseball-ESPN MCP Server Scaffolding Plan
*Created: 2025-06-12*

## Overview

Scaffold the first MCP server (`baseball-espn-mcp`) as a proof-of-concept for the multi-MCP routing architecture. This focuses on core ESPN fantasy baseball functionality.

---

## 1. Project Structure

```
baseball-espn-mcp/
├── src/
│   ├── index.ts          # Main MCP server entry point
│   ├── espn.ts           # ESPN API client helpers
│   ├── tools/            # Tool implementations
│   │   ├── getLeagueMeta.ts
│   │   ├── getRoster.ts
│   │   └── getLineup.ts
│   └── types/            # TypeScript definitions
│       ├── espn.ts       # ESPN API response types
│       └── mcp.ts        # MCP tool schemas
├── tests/
│   ├── tools/            # Unit tests for each tool
│   └── integration/      # E2E tests
├── wrangler.toml         # Cloudflare Worker config
├── package.json
├── tsconfig.json
└── .env                 # Local environment variables (ESPN cookies, etc.)
```

---

## 2. Core Tools (Initial Set)

| Tool | Purpose | ESPN Endpoint | Auth Required |
|------|---------|---------------|---------------|
| `getLeagueMeta` | League settings, scoring rules | `/apis/v3/games/flb/seasons/{year}/segments/0/leagues/{leagueId}?view=mSettings` | No* |
| `getRoster` | Team roster for scoring period | `/apis/v3/games/flb/seasons/{year}/segments/0/leagues/{leagueId}?forTeamId={teamId}&view=mRoster&scoringPeriodId={scoringPeriodId}` | Yes (S2 + SWID) |
| `getLineup` | Active starting lineup | `/apis/v3/games/flb/seasons/{year}/segments/0/leagues/{leagueId}?forTeamId={teamId}&view=mRoster&scoringPeriodId={scoringPeriodId}&rosterSlotMatchupType=ROSTER` | Yes (S2 + SWID) |

---

## 3. Development Phases

### Phase 1: Basic Scaffolding (Week 1)
- [ ] Initialize Cloudflare Worker project
- [ ] Set up MCP server boilerplate extending base agent
- [ ] Implement `getLeagueMeta` tool (public leagues only)
- [ ] Create ESPN API client with basic error handling
- [ ] Deploy to dev environment for testing

### Phase 2: Core Tools (Week 1 continued)
- [ ] Add `getRoster` and `getLineup` tools
- [ ] Load S2 and SWID from environment variables for authenticated requests
- [ ] Implement TypeScript types that mirror the JSON returned by the v3 endpoints (see espn_api/baseball models).
- [ ] Add basic unit tests for each tool

### Phase 3: Integration Testing (Week 2 prep)
- [ ] Create test suite for ESPN API interactions
- [ ] Validate MCP tool schemas match expected format
- [ ] Test error scenarios (invalid league IDs, network failures)
- [ ] Document tool usage examples

---

## 4. Technical Implementation Details

### 4.1 MCP Server Structure

```typescript
// src/index.ts
import { McpAgent } from '@cloudflare/workers-mcp';
import { getLeagueMeta, getRoster, getLineup } from './tools';

export default class BaseballEspnMcp extends McpAgent {
  constructor(private env: { ESPN_S2?: string; ESPN_SWID?: string }) {
    super();
  }

  async handleToolCall(name: string, args: any) {
    switch (name) {
      case 'getLeagueMeta':
        return await getLeagueMeta(args, this.env);
      case 'getRoster':
        return await getRoster(args, this.env);
      case 'getLineup':
        return await getLineup(args, this.env);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  getToolsList() {
    return [
      {
        name: 'getLeagueMeta',
        description: 'Get league settings and scoring configuration',
        inputSchema: {
          type: 'object',
          properties: {
            leagueId: { type: 'string' },
            year: { type: 'number', default: 2025 }
          },
          required: ['leagueId']
        }
      },
      // ... other tools
    ];
  }
}
```

### 4.1.1 Environment Variables

| Variable | Purpose |
|----------|---------|
| `ESPN_S2` | Session cookie string used for private‑league requests |
| `ESPN_SWID` | User SWID cookie required by ESPN APIs |

Create a local `.env` file with your private‑league credentials:

```ini
# .env
ESPN_S2=ABCD1234...   # replace with your actual s2 cookie
ESPN_SWID=%7B1234...%7D
```

**Cloudflare secret injection:**  
```bash
wrangler secret put ESPN_S2
wrangler secret put ESPN_SWID
```

### 4.2 ESPN API Client

```typescript
// src/espn.ts
// ESPN v3 Fantasy API (reference: github.com/cwendt94/espn-api)
export class EspnApiClient {
  constructor(private env: { ESPN_S2?: string; ESPN_SWID?: string }) {}

  private baseUrl = 'https://fantasy.espn.com/apis/v3';
  
  async fetchLeague(leagueId: string, year: number = 2025) {
    const url = `${this.baseUrl}/games/flb/seasons/${year}/segments/0/leagues/${leagueId}?view=mSettings`;
    
    const response = await fetch(url, {
      cf: { cacheEverything: false },
      headers: {
        'Cookie': `s2=${this.env.ESPN_S2}; SWID=${this.env.ESPN_SWID}`,
        'User-Agent': 'baseball-espn-mcp/1.0'
      }
    });
    
    if (!response.ok) {
      // Handle ESPN-specific error codes
      if (response.status === 401) {
        throw new Error('ESPN authentication failed - check ESPN_S2 and ESPN_SWID');
      }
      if (response.status === 429) {
        throw new Error('ESPN rate limit exceeded - please retry later');
      }
      if (response.status === 404) {
        throw new Error(`League ${leagueId} not found or not accessible`);
      }
      throw new Error(`ESPN API error: ${response.status}`);
    }
    
    return response.json();
  }
  
  // Additional methods for roster, lineup...
}
```

### 4.3 Tool Implementation Example

```typescript
// src/tools/getLeagueMeta.ts
import { EspnApiClient } from '../espn';

export async function getLeagueMeta(
  args: { leagueId: string; year?: number },
  env: { ESPN_S2?: string; ESPN_SWID?: string }
) {
  const client = new EspnApiClient(env);
  
  try {
    const league = await client.fetchLeague(args.leagueId, args.year);
    
    return {
      success: true,
      data: {
        name: league.settings.name,
        size: league.settings.size,
        scoringPeriodId: league.scoringPeriodId,
        status: league.status,
        scoringSettings: {
          type: league.settings.scoringSettings.scoringType,
          matchupPeriods: league.settings.scoringSettings.matchupPeriods
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
```

### 4.4 Leveraging the Community espn-api Library

- A review of the open‑source **espn-api** repo (github.com/cwendt94/espn-api) confirms that all fantasy‑sports modules call the same v3 endpoints.  
- MLB support is marked “Doc Coming Soon”, but the `espn_api/baseball` module already wraps league and roster requests, using the query‑string patterns adopted above.  
- These patterns (_view=mSettings_, _view=mRoster_, etc.) are now baked into our worker to stay consistent with community conventions.  
- Future work: import the Python client in integration tests to cross‑validate our TypeScript response types against the library’s parsed objects.

> **Note:** All runtime code in the Worker remains **TypeScript/JavaScript**.  
> The Python `espn-api` library is used **only** in offline integration tests or quick data‑inspection scripts; it is **not** bundled into the Worker.

---

## 5. Configuration & Deployment

### 5.1 Wrangler Configuration

```toml
# wrangler.toml
name = "baseball-espn-mcp"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[env.dev]
name = "baseball-espn-mcp-dev"

[env.prod]
name = "baseball-espn-mcp-prod"
```

### 5.2 Package Dependencies

```json
{
  "dependencies": {
    "@cloudflare/workers-mcp": "^1.0.0",
    "@cloudflare/workers-types": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "wrangler": "^3.0.0",
    "@types/node": "^20.0.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0"
  }
}
```

---

## 6. Testing Strategy

### 6.1 Unit Tests
- Mock ESPN API responses for consistent testing
- Validate tool input/output schemas
- Test error handling and edge cases

### 6.2 Integration Tests
- Use real ESPN public league for `getLeagueMeta`
- Validate MCP server responds correctly to tool calls
- Test deployment to Cloudflare Workers

### 6.3 Manual Testing
- Deploy to dev environment
- Test via MCP client or Postman
- Validate responses match expected schema

---

## 7. Success Criteria

- [ ] MCP server deploys successfully to Cloudflare Workers
- [ ] `getLeagueMeta` tool returns valid league information for public leagues
- [ ] `getRoster` and `getLineup` tools implemented with proper schemas
- [ ] All tools pass unit tests with >90% coverage
- [ ] Server responds to MCP tool list requests correctly
- [ ] Foundation ready for authentication integration in Phase 2
- Private‑league endpoints succeed when valid ESPN_S2 and ESPN_SWID are provided via secrets

---

## 7.1 Rate Limiting & Error Handling

- **ESPN-specific error codes**: 401 (auth), 429 (rate limit), 404 (league not found)
- **Exponential backoff**: Implement retry logic for transient failures
- **Circuit breaker**: Fail gracefully after consecutive API failures
- **Request caching**: Use Cloudflare KV for league metadata (1-hour TTL)

---

## 8. Next Steps (Post-Scaffolding)

1. **Authentication Integration** - Add OAuth flow and cookie management
2. **Gateway Integration** - Connect to main app's sport/platform routing
3. **Error Handling** - Robust error handling for auth failures, rate limits
4. **Additional Tools** - Add trade analyzer, waiver wire tools
5. **Production Hardening** - Logging, monitoring, performance optimization

---

## 9. Development Commands

```bash
# Setup
npm install
wrangler login

# Development
wrangler dev                    # Local development
npm test                       # Run tests
npm run type-check            # TypeScript validation

# Deployment
wrangler publish --env dev     # Deploy to dev
wrangler publish --env prod    # Deploy to production

# Monitoring
wrangler tail --env dev        # View logs
```

This scaffolding plan provides a solid foundation for the baseball-ESPN MCP server while maintaining simplicity and focusing on core functionality first.