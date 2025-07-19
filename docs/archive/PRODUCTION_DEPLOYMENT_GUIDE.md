# Production Deployment Guide - FLAIM v6.0+

> **Critical Issue Resolution**: This guide documents the complete process for deploying FLAIM to production after resolving legacy Durable Objects migration conflicts.

## Overview

This guide provides the definitive process for deploying FLAIM to production, including troubleshooting legacy Durable Objects issues and ensuring clean deployments with KV-based storage.

## Background: Migration from Durable Objects to KV Storage

**FLAIM v6.0.0** migrated from Durable Objects to Cloudflare KV storage with AES-GCM encryption. However, production environments with legacy Durable Objects can experience deployment failures due to missing class dependencies.

### Common Error Encountered

```
✘ [ERROR] New version of script does not export class 'EspnStorage' which is depended on by existing Durable Objects.
```

This error occurs when:
1. Production workers were previously deployed with Durable Objects
2. Code has been migrated to KV storage
3. Legacy Durable Objects still exist in production
4. Migration files don't properly clean up the legacy dependencies

## Nuclear Option: Clean Slate Deployment

When migration approaches fail, the safest approach is to **delete and recreate** production workers.

### Step 1: Delete Legacy Production Workers

```bash
# Navigate to each worker directory and delete production instance
cd workers/auth-worker
wrangler delete auth-worker --env prod

cd workers/baseball-espn-mcp
wrangler delete baseball-espn-mcp --env prod

cd workers/football-espn-mcp
wrangler delete football-espn-mcp --env prod
```

**⚠️ WARNING**: This will delete all production workers and their associated data. Ensure you have backups of any critical data.

### Step 2: Clean Migration Files

```bash
# Remove migration files since we're starting fresh
find workers -name "migrations.toml" -delete
```

## Fresh Production Deployment Process

### Prerequisites

#### 1. Domain Configuration
- **Domain**: `flaim.app` must be added to your Cloudflare account
- **DNS**: Domain must be pointed to Cloudflare nameservers
- **Zone Status**: Must be active and properly configured
- **Subdomain**: `api.flaim.app` will be used for worker routes

#### 2. Secrets Configuration

Generate encryption key:
```bash
openssl rand -base64 32
```

Set secrets for each worker:
```bash
# Auth Worker
cd workers/auth-worker
wrangler secret put CF_ENCRYPTION_KEY --env prod
wrangler secret put CLERK_SECRET_KEY --env prod

# Baseball Worker  
cd workers/baseball-espn-mcp
wrangler secret put CF_ENCRYPTION_KEY --env prod
wrangler secret put CLERK_SECRET_KEY --env prod

# Football Worker
cd workers/football-espn-mcp
wrangler secret put CF_ENCRYPTION_KEY --env prod
wrangler secret put CLERK_SECRET_KEY --env prod
```

#### 3. KV Namespace Verification

Verify KV namespace exists:
```bash
wrangler kv:namespace list
```

Expected namespace: `CF_KV_CREDENTIALS` with ID `3c946fc92ef84fd58d11c670d2e4120b`

### Deployment Order

**Critical**: Deploy in dependency order to avoid inter-service communication failures.

#### 1. Auth Worker (Foundation)
```bash
cd workers/auth-worker
wrangler deploy --env prod
```

**Verify deployment**:
```bash
curl https://api.flaim.app/auth/health
```

#### 2. Sport Workers (Parallel)
```bash
# Baseball Worker
cd workers/baseball-espn-mcp
wrangler deploy --env prod

# Football Worker
cd workers/football-espn-mcp
wrangler deploy --env prod
```

**Verify deployments**:
```bash
curl https://api.flaim.app/baseball/health
curl https://api.flaim.app/football/health
```

#### 3. Frontend (Final)
```bash
cd openai
npm run build
wrangler pages deploy .vercel/output --project-name flaim-frontend --branch production
```

## Configuration Verification

### Worker Configuration Files

All workers should use `flaim.app` domain in production:

```json
{
  "env": {
    "prod": {
      "routes": [
        {
          "pattern": "api.flaim.app/auth/*",
          "zone_name": "flaim.app"
        }
      ],
      "vars": {
        "AUTH_WORKER_URL": "https://api.flaim.app/auth"
      }
    }
  }
}
```

### Environment Variables

**Production environment variables**:
- `NODE_ENV`: "production"
- `ENVIRONMENT`: "prod"
- `AUTH_WORKER_URL`: "https://api.flaim.app/auth"

## Troubleshooting

### Domain Not Found Error

```
✘ [ERROR] Could not find zone for `flaim.app`
```

**Solution**: Ensure domain is added to Cloudflare account and DNS is configured.

### Durable Objects Migration Error

```
✘ [ERROR] New version of script does not export class 'EspnStorage'
```

**Solution**: Use the nuclear option (delete and recreate workers) as documented above.

### KV Namespace Issues

```
✘ [ERROR] KV namespace not found
```

**Solution**: Verify namespace exists and binding is correct in wrangler.jsonc.

## Security Considerations

### Encryption Keys
- Generate unique 32-byte base64 encryption keys
- Store as secrets in Cloudflare (never in code)
- Use same key across all workers for credential compatibility

### Domain Security
- Use HTTPS-only routes in production
- Proper CORS configuration for allowed origins
- Clerk session verification for all authenticated endpoints

## Post-Deployment Verification

### Health Check Endpoints
```bash
curl https://api.flaim.app/auth/health
curl https://api.flaim.app/baseball/health
curl https://api.flaim.app/football/health
```

### MCP Protocol Testing
```bash
curl -X POST https://api.flaim.app/baseball/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list"}'
```

### Frontend Verification
```bash
curl https://flaim.app
```

## Lessons Learned

### Migration Challenges
1. **Durable Objects Migration**: Standard migration approaches can fail with complex dependency chains
2. **Nuclear Option**: Sometimes deleting and recreating is safer than attempting complex migrations
3. **Dependency Order**: Auth worker must be deployed before sport workers due to inter-service communication

### Best Practices
1. **Domain Configuration**: Verify domain setup before deployment
2. **Secrets Management**: Use Cloudflare secrets for all sensitive data
3. **Health Checks**: Verify each component after deployment
4. **Clean State**: Remove migration files when doing fresh deployments

## Future Considerations

### Improved Migration Strategy
- Document proper Durable Objects to KV migration process
- Create migration scripts for future schema changes
- Test migration strategies in preview environments first

### Deployment Automation
- Integrate deployment order into CI/CD pipelines
- Add automated health checks post-deployment
- Create rollback procedures for failed deployments

## Related Documentation

- [KV Setup Guide](../archive/KV_SETUP.md)
- [Architecture Overview](../ARCHITECTURE.md)
- [Getting Started Guide](../GETTING_STARTED.md)

---

**Document Status**: Active  
**Last Updated**: 2025-07-18  
**Version**: 1.0.0  
**Covers**: FLAIM v6.0+ production deployment with KV storage