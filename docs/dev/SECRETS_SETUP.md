# Cloudflare Workers Secrets Setup

This guide provides the exact `wrangler secret put` commands needed to configure both ESPN MCP workers.

## Prerequisites

- Cloudflare account with Workers enabled
- `wrangler` CLI installed and authenticated (`wrangler whoami` should show your account)
- Encryption key generated (see `scripts/generate-encryption-key.sh` or `openssl rand -base64 32`)
- Clerk secret key from your Clerk dashboard

## Required Secrets

Both workers need the same secrets for credential storage and authentication:

| Secret Name | Purpose | Source |
|-------------|---------|---------|
| `CF_ENCRYPTION_KEY` | Encrypts ESPN credentials in KV storage | Generate with `openssl rand -base64 32` |
| `CLERK_SECRET_KEY` | Server-side Clerk authentication | Get from Clerk dashboard |

## Optional Development Secrets

For local development fallback (when no user credentials are available):

| Secret Name | Purpose | Source |
|-------------|---------|---------|
| `ESPN_S2` | Fallback ESPN S2 cookie | Your ESPN account cookies |
| `ESPN_SWID` | Fallback ESPN SWID cookie | Your ESPN account cookies |

## Setup Commands

### 1. Baseball Worker Secrets

```bash
cd workers/baseball-espn-mcp

# Required: Encryption key for credential storage
wrangler secret put CF_ENCRYPTION_KEY
# Paste your base64 encryption key when prompted

# Required: Clerk authentication
wrangler secret put CLERK_SECRET_KEY  
# Paste your Clerk secret key when prompted

# Optional: Development fallback credentials
wrangler secret put ESPN_S2
# Paste your ESPN S2 cookie value when prompted

wrangler secret put ESPN_SWID
# Paste your ESPN SWID cookie value when prompted
```

### 2. Football Worker Secrets

```bash
cd workers/football-espn-mcp

# Required: Encryption key (SAME as baseball worker)
wrangler secret put CF_ENCRYPTION_KEY
# Paste the SAME base64 encryption key when prompted

# Required: Clerk authentication (SAME as baseball worker)
wrangler secret put CLERK_SECRET_KEY
# Paste the SAME Clerk secret key when prompted

# Optional: Development fallback credentials (SAME as baseball worker)
wrangler secret put ESPN_S2
# Paste the SAME ESPN S2 cookie value when prompted

wrangler secret put ESPN_SWID
# Paste the SAME ESPN SWID cookie value when prompted
```

## Environment-Specific Secrets

If you want different secrets for dev/prod environments:

### Development Environment
```bash
# Baseball worker dev
cd workers/baseball-espn-mcp
wrangler secret put CF_ENCRYPTION_KEY --env dev
wrangler secret put CLERK_SECRET_KEY --env dev

# Football worker dev  
cd workers/football-espn-mcp
wrangler secret put CF_ENCRYPTION_KEY --env dev
wrangler secret put CLERK_SECRET_KEY --env dev
```

### Production Environment
```bash
# Baseball worker prod
cd workers/baseball-espn-mcp
wrangler secret put CF_ENCRYPTION_KEY --env prod
wrangler secret put CLERK_SECRET_KEY --env prod

# Football worker prod
cd workers/football-espn-mcp  
wrangler secret put CF_ENCRYPTION_KEY --env prod
wrangler secret put CLERK_SECRET_KEY --env prod
```

## Verification Commands

### List Secrets
```bash
# Baseball worker
cd workers/baseball-espn-mcp
wrangler secret list

# Football worker
cd workers/football-espn-mcp
wrangler secret list
```

### Test Health Check
After setting secrets, test that workers can start:

```bash
# Baseball worker
cd workers/baseball-espn-mcp
wrangler dev --env dev

# In another terminal, test health
curl http://localhost:8787/health
```

Expected healthy response:
```json
{
  "status": "healthy",
  "service": "baseball-espn-mcp", 
  "version": "4.0.0",
  "timestamp": "2024-12-26T01:30:00.000Z",
  "kv_status": "connected",
  "encryption_status": "configured"
}
```

## Security Best Practices

### Encryption Key
- **Generate once**: Use the same key for all workers and Next.js app
- **Store securely**: Never commit to version control or share in plain text
- **Backup safely**: Store in your password manager or secure vault
- **Rotate carefully**: If compromised, all stored credentials become unreadable

### Clerk Secret Key
- **Production vs Development**: Use different keys for different environments
- **Permissions**: Ensure the key has necessary permissions for user verification
- **Rotation**: Follow Clerk's key rotation best practices

### ESPN Credentials (Development Only)
- **Personal use only**: Only use your own ESPN account credentials
- **Temporary**: Remove these after setting up user credential flow
- **Private leagues**: These only work for leagues you're a member of

## Troubleshooting

### "Secret not found" Errors
```bash
# Verify secrets are set
wrangler secret list

# Set missing secrets
wrangler secret put MISSING_SECRET_NAME
```

### "Invalid encryption key" Errors
- Ensure the key is exactly 44 characters (32 bytes base64 encoded)
- Verify the same key is used in all workers and Next.js `.env.local`
- Regenerate if corrupted: `openssl rand -base64 32`

### "Clerk authentication failed" Errors
- Verify the secret key starts with `sk_test_` (development) or `sk_live_` (production)
- Check that the key matches your Clerk dashboard
- Ensure the key has the necessary permissions

### Health Check Shows "degraded"
- Check that both `CF_ENCRYPTION_KEY` and `CLERK_SECRET_KEY` are set
- Verify KV namespace is properly configured in `wrangler.toml`
- Test KV connectivity with `wrangler kv:key list --binding CF_KV_CREDENTIALS`

## Next Steps

1. **Complete KV setup**: Follow `docs/KV_SETUP.md` for namespace configuration
2. **Test locally**: Use `wrangler dev` to test both workers
3. **Deploy**: Use `wrangler deploy` when ready for production
4. **Monitor**: Check logs with `wrangler tail worker-name`

## Related Documentation

- `docs/dev/KV_SETUP.md` - Complete KV storage setup guide
- `docs/DEPLOYMENT.md` - Full deployment guide  
- `scripts/generate-encryption-key.sh` - Encryption key generator
- `openai/ENV_SAMPLE` - Next.js environment variables