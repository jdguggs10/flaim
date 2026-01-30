# Yahoo Client Worker

Yahoo Fantasy API client used by `fantasy-mcp` via service bindings.

## Role

- Handles Yahoo-specific tool execution (football + baseball today; more later).
- Fetches Yahoo OAuth credentials from `auth-worker` and calls Yahoo Fantasy API.

## Local Dev

```bash
cd workers/yahoo-client
npm run dev   # Port 8791
```

`fantasy-mcp` reaches this worker through Wrangler service bindings (not via a public URL).
See `workers/README.md` for the full local dev matrix and binding notes.
