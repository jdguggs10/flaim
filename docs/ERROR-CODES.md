# Error Codes

Canonical error codes for all Flaim workers. Defined in `workers/shared/src/errors.ts` and used across platform clients and the MCP gateway.

## Convention

Errors are thrown in `CODE: Human-readable message` format. Use `extractErrorCode(error)` from `@flaim/worker-shared` to parse the code from caught errors.

## Error Code Reference

### Auth

| Code | Description | Likely Cause | User Action |
|------|-------------|-------------|-------------|
| `AUTH_FAILED` | Authentication failed | Expired or invalid token | Re-authenticate via OAuth flow |
| `CREDENTIALS_MISSING` | No credentials found for the requested platform | User hasn't connected the platform | Connect platform at flaim.app/settings |
| `INSUFFICIENT_SCOPE` | Token lacks required scope for this tool | Token issued with narrower scope than needed | Re-authorize with required scopes |

### Platform Routing

| Code | Description | Likely Cause | User Action |
|------|-------------|-------------|-------------|
| `PLATFORM_NOT_SUPPORTED` | Requested platform is not supported | Invalid platform value in tool call | Use `espn` or `yahoo` |
| `PLATFORM_ERROR` | Platform client returned an unexpected error | Upstream API issue | Retry; check platform status |
| `ROUTING_ERROR` | Failed to route request to platform client | Internal service communication failure | Retry |

### Sport / Tool

| Code | Description | Likely Cause | User Action |
|------|-------------|-------------|-------------|
| `NOT_SUPPORTED` | Operation not supported | Tool/feature not implemented for this combination | Check supported tools |
| `INVALID_SPORT` | Invalid sport value | Unrecognized sport string | Use `football`, `baseball`, `basketball`, or `hockey` |
| `SPORT_NOT_SUPPORTED` | Sport not supported on this platform | Platform client doesn't handle this sport yet | Check platform parity in STATUS.md |
| `UNKNOWN_TOOL` | Unknown tool name | Misspelled or nonexistent tool | Check available tools via `tools/list` |

Note: `basketball` and `hockey` are valid sport values in the contract, but current ESPN/Yahoo support is still pending. Expect `NOT_SUPPORTED`/`SPORT_NOT_SUPPORTED` until those handlers ship.

### ESPN-Specific

| Code | Description | Likely Cause | User Action |
|------|-------------|-------------|-------------|
| `ESPN_COOKIES_EXPIRED` | ESPN session cookies have expired | Cookies older than ~30 days | Re-sync cookies via extension |
| `ESPN_ACCESS_DENIED` | ESPN denied access to the league | Private league without valid credentials | Verify league membership and re-sync cookies |
| `ESPN_NOT_FOUND` | League or resource not found on ESPN | Invalid league ID or season year | Verify league ID from `get_user_session` |
| `ESPN_RATE_LIMIT` | ESPN rate limit hit | Too many requests in short window | Wait and retry |
| `ESPN_API_ERROR` | ESPN API returned an error | Upstream ESPN issue | Retry |
| `ESPN_INVALID_RESPONSE` | ESPN response couldn't be parsed | Unexpected response shape from ESPN | Retry; may indicate API change |
| `ESPN_CREDENTIALS_NOT_FOUND` | No ESPN credentials stored for user | User hasn't synced ESPN cookies | Sync via extension at flaim.app/settings |
| `ESPN_ERROR` | Generic ESPN error | Catch-all for unclassified ESPN failures | Retry |

### Yahoo-Specific

| Code | Description | Likely Cause | User Action |
|------|-------------|-------------|-------------|
| `YAHOO_AUTH_ERROR` | Yahoo OAuth token invalid | Expired or revoked Yahoo token | Re-connect Yahoo at flaim.app/settings |
| `YAHOO_ACCESS_DENIED` | Yahoo denied access | Private league or insufficient permissions | Verify league membership |
| `YAHOO_NOT_FOUND` | League or resource not found on Yahoo | Invalid league key or season | Verify league key from `get_user_session` |
| `YAHOO_RATE_LIMITED` | Yahoo rate limit hit | Too many requests | Wait and retry |
| `YAHOO_API_ERROR` | Yahoo API returned an error | Upstream Yahoo issue | Retry |
| `YAHOO_NOT_CONNECTED` | No Yahoo account connected | User hasn't linked Yahoo | Connect Yahoo at flaim.app/settings |
| `YAHOO_TIMEOUT` | Yahoo API request timed out | Slow upstream response | Retry |

### Data

| Code | Description | Likely Cause | User Action |
|------|-------------|-------------|-------------|
| `LEAGUES_MISSING` | No leagues found for user | User has no configured leagues | Add leagues at flaim.app/settings |
| `TEAM_ID_MISSING` | Team ID required but not provided | Tool needs a team_id parameter | Pass `team_id` from `get_user_session` |
| `LIMIT_EXCEEDED` | Request exceeds allowed limits | Count parameter too high | Reduce `count` parameter |
| `DUPLICATE` | Duplicate entry detected | Attempting to create something that already exists | No action needed |

### Generic

| Code | Description | Likely Cause | User Action |
|------|-------------|-------------|-------------|
| `INTERNAL_ERROR` | Unclassified internal error | Bug or unexpected failure | Retry; report if persistent |
