# Fantasy Sports MCP v2.0 - Deployment Guide

## Dual-Layer Authentication Architecture

This deployment implements the new dual-layer authentication system with OAuth + JWT outer ring and encrypted credential storage inner ring.

## Prerequisites

1. **Cloudflare Workers account** with Durable Objects enabled
2. **GitHub OAuth application** for authentication  
3. **Stripe account** (optional, for paid features)

## 1. GitHub OAuth Setup

1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Create a new OAuth App with:
   - **Application name**: Fantasy Sports MCP
   - **Homepage URL**: `https://fantasy-sports-mcp-dev.gerrygugger.workers.dev`
   - **Authorization callback URL**: `https://fantasy-sports-mcp-dev.gerrygugger.workers.dev/callback`

3. Note down the **Client ID** and **Client Secret**

## 2. Required Secrets

Set these secrets using `wrangler secret put`:

```bash
# OAuth credentials  
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# JWT signing secret (generate a strong random string)
wrangler secret put JWT_SECRET

# Encryption key for credential storage (32 chars)
wrangler secret put ENCRYPTION_KEY

# Stripe webhook secret (if using Stripe)
wrangler secret put STRIPE_WEBHOOK_SECRET
```

### Generate Random Secrets

```bash
# JWT Secret (64 characters)
openssl rand -base64 48

# Encryption Key (32 characters for AES-256)
openssl rand -base64 32
```

## 3. Deploy to Cloudflare

```bash
# Install dependencies (includes all required packages)
npm install

# Note: Dependencies include:
# - @cloudflare/workers-oauth-provider (OAuth 2.1 PKCE)
# - @cloudflare/agents (MCP server implementation)
# - jose (JWT handling)
# - stripe (webhook signature verification)

# Deploy to dev environment
npm run deploy:dev

# Deploy to production
npm run deploy:prod
```

## 4. Stripe Integration (Optional)

If you want to enable the paywall:

1. Create a Stripe webhook endpoint pointing to:
   `https://fantasy-sports-mcp-prod.gerrygugger.workers.dev/webhook/stripe`

2. Configure webhook events:
   - `customer.subscription.created`
   - `customer.subscription.updated` 
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.payment_succeeded`

3. Set the webhook signing secret:
   ```bash
   wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

## 5. Frontend Integration

Update your frontend to use the new authentication flow:

```json
{
  "type": "mcp",
  "server_label": "fantasy-sports",
  "server_url": "https://fantasy-sports-mcp-prod.gerrygugger.workers.dev/mcp",
  "headers": {
    "Authorization": "Bearer <JWT_TOKEN>"
  },
  "allowed_tools": ["get_espn_league_info", "get_espn_team_roster", "get_espn_matchups"],
  "require_approval": "never"
}
```

## 6. Testing the Deployment

1. **Test OAuth Flow**:
   - Visit `https://fantasy-sports-mcp-dev.gerrygugger.workers.dev`
   - Click "Login with GitHub"
   - Complete OAuth flow and receive JWT

2. **Test Credential Storage**:
   - Use the JWT to store ESPN credentials
   - Verify they are encrypted and retrievable

3. **Test MCP Tools**:
   - Call MCP endpoints with JWT in Authorization header
   - Verify tools require proper authentication

## 7. Security Checklist

- [x] **OAuth PKCE enabled**: Prevents authorization code interception
- [x] **JWT short expiry**: 15-minute tokens prevent long-term compromise  
- [x] **JWT audience validation**: Tokens validated with aud claim
- [x] **Encrypted storage**: ESPN credentials encrypted with AES-GCM
- [x] **User isolation**: Durable Objects provide per-user storage isolation
- [x] **CORS configured**: Proper cross-origin resource sharing
- [x] **Webhook verification**: Stripe webhooks verified with HMAC-SHA256
- [x] **Key rotation**: JWT signing keys rotated quarterly
- [x] **WebCrypto API**: All cryptographic operations use secure APIs

## 8. Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `GITHUB_CLIENT_ID` | OAuth client ID | Yes |
| `GITHUB_CLIENT_SECRET` | OAuth client secret | Yes |
| `JWT_SECRET` | JWT signing key | Yes |
| `ENCRYPTION_KEY` | Credential encryption | Yes |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification | Optional |

## 9. API Endpoints

### Authentication
- `GET /` - Home page with login
- `GET /authorize` - OAuth authorization
- `GET /callback` - OAuth callback
- `POST /webhook/stripe` - Stripe webhook handler

### User Management
- `POST /user/{userId}/credentials/espn` - Store ESPN credentials
- `GET /user/{userId}/credentials/espn` - Get ESPN credentials  
- `DELETE /user/{userId}/credentials/espn` - Delete ESPN credentials
- `GET /user/{userId}/subscription` - Get subscription status

### MCP
- `GET /mcp` - MCP server info
- `GET /mcp/tools/list` - List available tools
- `POST /mcp/tools/call` - Execute tool

## 10. Migration from v1.0

1. **Backup existing data** from KV storage
2. **Deploy v2.0** to dev environment
3. **Test thoroughly** with real credentials
4. **Migrate users** by having them re-authenticate
5. **Deploy to production** when ready
6. **Sunset v1.0** endpoints

## 11. Monitoring

Monitor these metrics in Cloudflare:
- Request success/failure rates
- Authentication errors
- Durable Object usage
- Tool execution latency

## Support

For issues or questions, check:
1. Cloudflare Workers logs: `wrangler tail`
2. Browser developer console for frontend errors  
3. GitHub repository issues for bug reports

---

**Security Note**: This implementation provides enterprise-grade security with OAuth 2.0, JWT tokens, encrypted storage, and user isolation. All credentials are encrypted at rest and never exposed in logs or API responses.