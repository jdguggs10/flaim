# Production Deployment Checklist - FLAIM

> **Quick Reference**: Step-by-step checklist for FLAIM production deployment with all prerequisites and verification steps.

## Pre-Deployment Requirements

### ✅ Domain Configuration
- [ ] `flaim.app` domain added to Cloudflare account
- [ ] DNS pointed to Cloudflare nameservers
- [ ] Domain status: **Active** in Cloudflare dashboard
- [ ] SSL certificate: **Active** and **Full (strict)**

### ✅ Secrets Configuration

#### Generate Encryption Key
```bash
openssl rand -base64 32
```

#### Set Secrets for Each Worker
```bash
# Auth Worker
cd workers/auth-worker
wrangler secret put CF_ENCRYPTION_KEY --env prod  # [32-byte base64 key]
wrangler secret put CLERK_SECRET_KEY --env prod   # [sk_live_...]

# Baseball Worker  
cd workers/baseball-espn-mcp
wrangler secret put CF_ENCRYPTION_KEY --env prod  # [same key as auth]
wrangler secret put CLERK_SECRET_KEY --env prod   # [same key as auth]

# Football Worker
cd workers/football-espn-mcp
wrangler secret put CF_ENCRYPTION_KEY --env prod  # [same key as auth]
wrangler secret put CLERK_SECRET_KEY --env prod   # [same key as auth]
```

### ✅ KV Namespace Verification
```bash
wrangler kv:namespace list | grep CF_KV_CREDENTIALS
```
Expected: `CF_KV_CREDENTIALS` with ID `3c946fc92ef84fd58d11c670d2e4120b`

### ✅ Configuration Verification
- [ ] All `wrangler.jsonc` files use `flaim.app` domain
- [ ] Production routes configured: `api.flaim.app/auth/*`, `api.flaim.app/baseball/*`, `api.flaim.app/football/*`
- [ ] Environment variables: `NODE_ENV=production`, `ENVIRONMENT=prod`
- [ ] No migration files present (clean deployment)

## Deployment Process

### Step 1: Deploy Auth Worker (Foundation)
```bash
cd workers/auth-worker
wrangler deploy --env prod
```

#### Verification
```bash
curl https://api.flaim.app/auth/health
```
Expected: `{"status": "healthy", "service": "auth-worker"}`

### Step 2: Deploy Baseball Worker
```bash
cd workers/baseball-espn-mcp
wrangler deploy --env prod
```

#### Verification
```bash
curl https://api.flaim.app/baseball/health
```
Expected: `{"status": "healthy", "service": "baseball-espn-mcp"}`

### Step 3: Deploy Football Worker
```bash
cd workers/football-espn-mcp
wrangler deploy --env prod
```

#### Verification
```bash
curl https://api.flaim.app/football/health
```
Expected: `{"status": "healthy", "service": "football-espn-mcp"}`

### Step 4: Deploy Frontend
```bash
cd openai
npm run build
wrangler pages deploy .vercel/output --project-name flaim-frontend --branch production
```

#### Verification
```bash
curl https://flaim.app
```
Expected: HTML response with FLAIM application

## Post-Deployment Verification

### ✅ Health Checks
- [ ] Auth worker: `curl https://api.flaim.app/auth/health`
- [ ] Baseball worker: `curl https://api.flaim.app/baseball/health`  
- [ ] Football worker: `curl https://api.flaim.app/football/health`
- [ ] Frontend: `curl https://flaim.app`

### ✅ MCP Protocol Testing
```bash
# Test MCP capabilities
curl -X POST https://api.flaim.app/baseball/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list"}'
```
Expected: JSON response with available MCP tools

### ✅ Authentication Flow
- [ ] Visit `https://flaim.app`
- [ ] Test Clerk sign-in/sign-up
- [ ] Verify authentication persistence
- [ ] Test protected routes

### ✅ Cross-Service Communication
- [ ] Baseball worker can reach auth worker
- [ ] Football worker can reach auth worker
- [ ] Frontend can reach all workers
- [ ] MCP tools respond correctly

## Troubleshooting Quick Reference

### Common Issues

#### Domain Not Found
```
✘ [ERROR] Could not find zone for `flaim.app`
```
**Solution**: Add domain to Cloudflare account, verify DNS

#### Secrets Not Found
```
✘ [ERROR] Environment variable not found
```
**Solution**: Set secrets using `wrangler secret put`

#### KV Namespace Issues
```
✘ [ERROR] KV namespace not found
```
**Solution**: Verify namespace ID in `wrangler.jsonc`

#### Health Check Failures
```
curl: (7) Failed to connect to api.flaim.app
```
**Solution**: Verify domain configuration and deployment success

### Diagnostic Commands
```bash
# Check deployment status
wrangler deployments list

# Check worker logs
wrangler tail auth-worker --env prod

# List KV namespaces
wrangler kv:namespace list

# Test DNS resolution
nslookup api.flaim.app
```

## Rollback Procedures

### If Auth Worker Fails
1. Check secrets configuration
2. Verify domain setup
3. Re-deploy auth worker
4. Test health endpoint

### If Sport Workers Fail
1. Verify auth worker is healthy
2. Check AUTH_WORKER_URL configuration
3. Re-deploy failing worker
4. Test inter-service communication

### If Frontend Fails
1. Check build artifacts
2. Verify Pages project configuration
3. Re-deploy frontend
4. Test application functionality

## Success Criteria

### ✅ All Systems Operational
- [ ] All workers responding to health checks
- [ ] Frontend accessible at `https://flaim.app`
- [ ] MCP tools returning valid responses
- [ ] Authentication flow working
- [ ] Cross-service communication functional

### ✅ Performance Metrics
- [ ] Response times < 200ms for health checks
- [ ] No 5xx errors in logs
- [ ] SSL certificate valid
- [ ] All services show "healthy" status

### ✅ Security Verification
- [ ] All secrets properly configured
- [ ] No credentials exposed in logs
- [ ] HTTPS enforced on all endpoints
- [ ] CORS policies configured correctly

## Next Steps After Deployment

1. **Monitoring Setup**: Configure Cloudflare Analytics and Worker logs
2. **Testing**: Run comprehensive end-to-end tests
3. **Documentation**: Update deployment logs and notes
4. **Backup**: Document current configuration for future reference

## Emergency Contacts

- **Domain Issues**: Cloudflare Support
- **Worker Issues**: Check Cloudflare Workers documentation
- **Code Issues**: Review GitHub repository and documentation

---

**Checklist Version**: 1.0.0  
**Last Updated**: 2025-07-18  
**Covers**: FLAIM v6.0+ production deployment