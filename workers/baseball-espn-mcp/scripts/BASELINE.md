# Baseball MCP Baseline Responses

> Captured: 2026-01-15T16:56:03Z
> Source: https://baseball-espn-mcp.gerrygugger.workers.dev (production)

This document captures the expected behavior of each endpoint before the Hono/MCP SDK migration.
Use this as the reference for parity verification at each checkpoint.

---

## 1. Health Endpoint

**Request:** `GET /baseball/health`

**Expected Response:** HTTP 200
```json
{
  "status": "healthy",
  "service": "baseball-espn-mcp",
  "version": "4.0.0",
  "timestamp": "<ISO timestamp>",
  "auth_worker_status": "connected",
  "auth_worker_binding": true,
  "credential_storage": "supabase_via_auth_worker"
}
```

**Key fields to verify:**
- `status` is `"healthy"` or `"degraded"`
- `service` is `"baseball-espn-mcp"`
- `version` is `"4.0.0"` (update if version changes)
- `auth_worker_status` should be `"connected"` in production

---

## 2. OAuth Protected Resource Metadata

**Request:** `GET /baseball/.well-known/oauth-protected-resource`

**Expected Response:** HTTP 200
```json
{
  "resource": "https://api.flaim.app/baseball/mcp",
  "authorization_servers": ["https://api.flaim.app"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": ["mcp:read", "mcp:write"]
}
```

**Key fields to verify:**
- RFC 9728 compliant structure
- `resource` points to the MCP endpoint
- `authorization_servers` includes the auth server

---

## 3. CORS Preflight

**Request:** `OPTIONS /baseball/mcp`
```
Origin: https://flaim.app
Access-Control-Request-Method: POST
```

**Expected Response:** HTTP 200 with headers:
```
access-control-allow-origin: https://flaim.app
access-control-allow-headers: Content-Type, Authorization
access-control-allow-methods: GET, POST, PUT, DELETE, OPTIONS
```

**Key behaviors to verify:**
- Returns 200 for allowed origins
- `Access-Control-Allow-Origin` echoes the request origin (if allowed)
- Methods include `POST` (needed for MCP)

---

## 4. MCP Unauthorized Request

**Request:** `POST /baseball/mcp`
```json
{"jsonrpc":"2.0","method":"initialize","id":1}
```
(No Authorization header)

**Expected Response:** HTTP 401
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32001,
    "message": "Authentication required. Please authorize via OAuth.",
    "_meta": {
      "mcp/www_authenticate": [
        "Bearer resource_metadata=\"https://api.flaim.app/baseball/.well-known/oauth-protected-resource\", error=\"unauthorized\", error_description=\"Authentication required\""
      ]
    }
  },
  "id": 1
}
```

**Critical fields to verify:**
- `error.code` is `-32001`
- `error._meta["mcp/www_authenticate"]` exists and contains resource_metadata URL
- This is what triggers ChatGPT's OAuth flow

---

## 5. Onboarding Unauthorized Request

**Request:** `POST /baseball/onboarding/initialize`
```json
{}
```
(No Authorization header)

**Expected Response:** HTTP 401
```json
{
  "error": "Authentication required"
}
```

---

## Summary Checklist

| Endpoint | Method | Expected Status | Key Verification |
|----------|--------|-----------------|------------------|
| `/baseball/health` | GET | 200 | `status` field present |
| `/baseball/.well-known/oauth-protected-resource` | GET | 200 | RFC 9728 structure |
| `/baseball/mcp` | OPTIONS | 200 | CORS headers present |
| `/baseball/mcp` (no auth) | POST | 401 | `_meta["mcp/www_authenticate"]` present |
| `/baseball/onboarding/initialize` (no auth) | POST | 401 | Error message returned |

---

## Notes

- The custom domain `api.flaim.app` may not be resolvable from all networks
- Use `*.workers.dev` URLs for verification when custom domain is inaccessible
- Production URL: `https://baseball-espn-mcp.gerrygugger.workers.dev`
- Preview URL: `https://baseball-espn-mcp-preview.gerrygugger.workers.dev`
