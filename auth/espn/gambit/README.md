# ESPN Gambit League Discovery

Automatic fantasy league discovery using ESPN's internal gambit dashboard endpoint.

## Overview

This module implements automatic league discovery by reverse-engineering ESPN's internal API endpoint that powers their "My Teams" dashboard. When a user authenticates with ESPN credentials, the system can automatically discover all fantasy leagues (across all sports) that the user belongs to.

## Architecture

### Key Files

- **`schema.ts`** - TypeScript interfaces for ESPN gambit API responses
- **`errors.ts`** - Custom error classes for league discovery failures  
- **`league-discovery.ts`** - Core discovery service using ESPN's gambit endpoint
- **`integration.ts`** - Integration helpers for FLAIM authentication flow
- **`index.ts`** - Public API exports

### ESPN Gambit Endpoint

```
GET https://gambit-api.fantasy.espn.com/apis/v1/dashboards/espn-en?view=allon
```

**Authentication**: ESPN cookies (`SWID` + `espn_s2`)  
**Response**: JSON with `fantasyDashboard.leagues` array containing all user leagues

## Usage

### Basic Discovery

```typescript
import { discoverLeagues } from '@flaim/auth/espn/gambit';

try {
  const leagues = await discoverLeagues(swid, espn_s2);
  console.log(`Found ${leagues.length} leagues:`, leagues);
} catch (error) {
  if (error instanceof AutomaticLeagueDiscoveryFailed) {
    // Handle discovery failure gracefully
    console.log('Discovery failed:', error.message);
  }
}
```

### Safe Discovery (No Exceptions)

```typescript
import { discoverLeaguesSafe } from '@flaim/auth/espn/gambit';

const result = await discoverLeaguesSafe(swid, espn_s2);
if (result.success) {
  console.log('Leagues:', result.leagues);
} else {
  console.log('Error:', result.error);
}
```

### Integration with FLAIM Auth

```typescript
import { discoverLeaguesWithCredentials } from '@flaim/auth/espn/gambit/integration';

const espnCredentials = await getStoredCredentials(userId);
const result = await discoverLeaguesWithCredentials(espnCredentials);

console.log('Baseball leagues:', result.baseballLeagues);
console.log('Football leagues:', result.footballLeagues);
```

## Response Format

### GambitLeague Interface

```typescript
interface GambitLeague {
  gameId: string;        // "ffl", "flb", "fba", etc.
  leagueId: string;      // numeric string
  leagueName: string;    // display name
  seasonId: number;      // year (2024, 2025, etc.)
  teamId: number;        // user's team ID in league
  teamName: string;      // user's team name
}
```

### Sport Mappings

| ESPN Game ID | Sport |
|-------------|-------|
| `ffl` | Football |
| `flb` | Baseball |
| `fba` | Basketball |
| `fho` | Hockey |

## Error Handling

### Error Types

- **`EspnCredentialsRequired`** - Missing SWID or espn_s2 cookies
- **`EspnAuthenticationFailed`** - Invalid/expired credentials (401/403)
- **`AutomaticLeagueDiscoveryFailed`** - Discovery endpoint failed or returned invalid data

### Fallback Strategy

1. **Single Endpoint Call**: Only tries the gambit dashboard endpoint
2. **Fast Failure**: No retry loops or secondary probing
3. **Graceful Degradation**: Falls back to manual league ID entry
4. **User-Friendly**: Clear error messages for different failure modes

## Integration Points

### Workers (MCP Services)

```typescript
// workers/baseball-espn-mcp/src/index.ts
if (url.pathname === '/discover-leagues') {
  const { discoverUserLeagues } = await import('./tools/discoverLeagues.js');
  const result = await discoverUserLeagues({ clerkUserId }, env);
  return Response.json(result);
}
```

### Frontend (React Components)

```typescript
// auth/espn/auth-component.tsx
const discoverUserLeagues = async () => {
  const response = await fetch(`${mcpBaseUrl}/discover-leagues`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const result = await response.json();
  setDiscoveredLeagues(result.data.allLeagues);
};
```

## Performance & Observability

### Expected Response Times
- **Gambit dashboard**: ≤ 150ms typical response time
- **Rate limits**: ~60 requests/minute per IP (shared with other ESPN endpoints)

### Monitoring
- Log response times and status codes
- Track discovery success/failure rates
- Alert on error rate > 1% over 5 minutes

### Security
- Never log full credentials (only last 4 chars of SWID for correlation)
- Respect ESPN's ToS (avoid heavy polling)
- Store credentials encrypted at rest

## Testing

Run tests with:
```bash
npm test auth/espn/gambit/tests/
```

### Test Coverage
- ✅ Successful league discovery
- ✅ Authentication failures (401/403)
- ✅ Network errors and timeouts
- ✅ Invalid response formats
- ✅ Empty league arrays
- ✅ Partial/malformed league data

## Future Enhancements

1. **Cache Results**: Cache discovery results for short periods
2. **Background Refresh**: Periodic re-discovery for active users
3. **League Metadata**: Fetch additional league settings/info
4. **Multi-Season**: Discover leagues across multiple seasons
5. **Webhook Integration**: Real-time updates when users join/leave leagues

## Troubleshooting

### Common Issues

**Discovery Returns Empty Array**
- User may not be in any active leagues for current season
- Credentials may be valid but expired/limited access

**401/403 Authentication Errors**
- ESPN credentials expired (espn_s2 has ~30 day TTL)
- User needs to re-authenticate on ESPN website

**Rate Limiting (429)**
- Reduce discovery frequency
- Implement exponential backoff

### Debug Mode

Enable debug logging:
```typescript
// Set DEBUG=espn:gambit for detailed logging
const leagues = await discoverLeagues(swid, s2);
```

## References

- [ESPN Hidden API Documentation](https://gist.github.com/akeaswaran/b48b02f1c94f873c6655e7129910fc3b)
- [Community ESPN API Wrappers](https://github.com/cwendt94/espn-api)
- [ESPN Fantasy API Analysis](https://stmorse.github.io/journal/espn-fantasy-v3.html)