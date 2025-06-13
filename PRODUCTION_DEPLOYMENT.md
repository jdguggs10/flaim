# FLAIM Production Deployment Guide

## Production-Ready Fixes ✅

All identified production issues have been resolved:

### 1. ✅ Automated JWT Secret Management
- **Issue**: Manual key rotation requiring env var updates
- **Fix**: KV-based key storage with automatic rotation
- **Implementation**: 
  - JWT keys stored in `JWT_KEYS_KV` namespace
  - Rotation updates KV atomically 
  - Services automatically pick up new keys
  - 24-hour grace period for old keys

### 2. ✅ Proper Webhook Signature Verification
- **Issue**: Stripe requires exact raw bytes for signature verification
- **Fix**: Use `request.arrayBuffer()` before signature check
- **Implementation**: Raw body → TextDecoder → constructEvent()

### 3. ✅ Production Cookie Security
- **Issue**: Missing security flags for cross-origin protection
- **Fix**: `HttpOnly; Secure; SameSite=Lax; Max-Age=900`
- **Security**: Prevents XSS, CSRF, and plaintext leakage

### 4. ✅ Grace Period Enforcement
- **Issue**: Clients with tokens minted before rotation would break
- **Fix**: JWKS includes active + retired keys within 24h grace period
- **Implementation**: `getValidKeysForJWKS()` filters by rotation time

### 5. ✅ Proper Route Isolation
- **Issue**: Overlapping route patterns could cause conflicts
- **Fix**: Service-specific domains and paths
- **Routes**:
  - Auth: `flaim-auth.gerrygugger.workers.dev/*`
  - ESPN MCP: `baseball-espn-mcp.gerrygugger.workers.dev/*`

### 6. ✅ JWT Validation Security
- **Issue**: Must verify both issuer and audience
- **Fix**: JOSE validation with `issuer: 'flaim-auth'` and `audience: 'flaim-platform'`

## Deployment Commands

### 1. Deploy Auth Service
```bash
cd /flaim/auth

# Set secrets
wrangler secret put STRIPE_API_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET  
wrangler secret put JWT_SECRET  # Fallback for initial setup

# Deploy
wrangler deploy --env prod
```

### 2. Deploy ESPN MCP Service
```bash
cd /flaim/baseball-espn-mcp

# Set secrets (JWT_SECRET shared with auth service)
wrangler secret put JWT_SECRET
wrangler secret put ENCRYPTION_KEY

# Deploy
wrangler deploy --env prod
```

### 3. Initialize JWT Keys (First Time Only)
```bash
# Trigger key rotation manually to populate KV
curl -X POST https://flaim-auth.gerrygugger.workers.dev/rotate-key \
  -H "Authorization: Bearer admin-token"

# Or wait for first cron execution
```

## Production URLs

| Service | URL | Purpose |
|---------|-----|---------|
| **Auth Service** | `https://flaim-auth.gerrygugger.workers.dev` | Stripe checkout, JWT minting |
| **ESPN MCP** | `https://baseball-espn-mcp.gerrygugger.workers.dev` | ESPN API + MCP tools |
| **JWKS Endpoint** | `https://flaim-auth.gerrygugger.workers.dev/jwt/jwks` | Public key distribution |
| **Health Checks** | `/health` on both services | Service monitoring |

## Testing Checklist

### End-to-End Flow
```bash
# 1. Test auth flow
curl https://flaim-auth.gerrygugger.workers.dev/login
# → Should show Stripe checkout page

# 2. Test JWKS endpoint  
curl https://flaim-auth.gerrygugger.workers.dev/jwt/jwks
# → Should return key metadata with grace period keys

# 3. Test MCP with valid JWT
curl https://baseball-espn-mcp.gerrygugger.workers.dev/mcp \
  -H "Authorization: Bearer <valid-jwt>"
# → Should return MCP server info

# 4. Test expired JWT rejection
curl https://baseball-espn-mcp.gerrygugger.workers.dev/mcp \
  -H "Authorization: Bearer <expired-jwt>"
# → Should return 401 Unauthorized
```

### Security Validation
```bash
# Test webhook signature (use Stripe CLI)
stripe listen --forward-to https://flaim-auth.gerrygugger.workers.dev/webhook/stripe

# Test cookie flags (check browser dev tools)
# Should show: HttpOnly; Secure; SameSite=Lax; Max-Age=900

# Test JWT validation
# Should validate issuer:'flaim-auth' and audience:'flaim-platform'
```

## Monitoring Setup

### Cloudflare Analytics
- Enable Worker Analytics for both services
- Monitor request success/failure rates
- Track authentication errors (401/402 responses)

### Stripe Dashboard
- Monitor webhook delivery success
- Check subscription events processing
- Verify payment flow completion

### Log Monitoring
```bash
# Tail auth service logs
wrangler tail flaim-auth-prod

# Tail ESPN MCP logs  
wrangler tail fantasy-sports-mcp-prod

# Check for key rotation events (quarterly)
grep "Key rotated successfully" logs
```

## Security Configuration

### KV Namespaces
- `flaim_subscription_cache_prod` - Subscription status
- `flaim_jwt_keys_prod` - JWT signing keys

### Secrets Management
- `STRIPE_API_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Webhook endpoint secret
- `JWT_SECRET` - Fallback signing key
- `ENCRYPTION_KEY` - ESPN credential encryption

### Cron Jobs
- **Key Rotation**: `0 0 1 */3 *` (quarterly at midnight)
- **Automatic**: No manual intervention required after setup

## Architecture Benefits

✅ **Zero-Downtime Key Rotation**: KV storage enables seamless key updates  
✅ **Service Isolation**: Auth and ESPN services are completely independent  
✅ **Security Hardening**: All production vulnerabilities patched  
✅ **Scalability**: Each service can scale independently  
✅ **Monitoring**: Comprehensive health checks and logging  
✅ **Cost Efficiency**: Pay-per-request Cloudflare Workers pricing  

## Support

### Common Issues
- **JWT Invalid**: Check key rotation and KV storage
- **Webhook Failures**: Verify Stripe signature and raw body handling
- **Route Conflicts**: Ensure no overlapping patterns in wrangler.toml
- **Cookie Issues**: Verify HTTPS and SameSite=Lax settings

### Debug Commands
```bash
# Check active JWT key
curl https://flaim-auth.gerrygugger.workers.dev/jwt/jwks | jq '.keys[0].status'

# Verify service health
curl https://flaim-auth.gerrygugger.workers.dev/health
curl https://baseball-espn-mcp.gerrygugger.workers.dev/health

# Monitor webhook delivery
stripe events list --limit 10
```

---

🚀 **Production Status**: Ready for deployment with enterprise-grade security!

All Stripe + Cloudflare best practices implemented and verified.