# Cloudflare KV Setup Guide

This guide walks through the exact steps to set up Cloudflare KV storage for ESPN credential encryption in the FLAIM platform.

## Prerequisites

- Cloudflare account with Workers enabled
- `wrangler` CLI installed and authenticated
- `openssl` available (for encryption key generation)

## Step 1: Create KV Namespace

Create a KV namespace for storing encrypted ESPN credentials:

```bash
wrangler kv:namespace create espn_credentials
```

**Expected Output:**
```
🌀 Creating namespace with title "espn_credentials"
✅ Success!
Add the following to your configuration file in your kv_namespaces array:
[[kv_namespaces]]
binding = "NAMESPACE"
id = "abc123def456789..."
preview_id = "xyz789abc123456..."
```

**Important:** Save both IDs from the output - you'll need them in the next step.

## Step 2: Update wrangler.jsonc Files

Update both worker configuration files with your namespace IDs:

### Baseball Worker
Edit `workers/baseball-espn-mcp/wrangler.jsonc`:

```toml
# Replace placeholder with your actual namespace ID
[[kv_namespaces]]
binding = "CF_KV_CREDENTIALS"
id = "abc123def456789..."          # ← Your namespace ID from step 1
preview_id = "xyz789abc123456..."   # ← Your preview ID from step 1

# Also update the dev environment
[[env.dev.kv_namespaces]]
binding = "CF_KV_CREDENTIALS"
id = "abc123def456789..."          # ← Same IDs for dev (or create separate dev namespace)
preview_id = "xyz789abc123456..."

# And prod environment
[[env.prod.kv_namespaces]]
binding = "CF_KV_CREDENTIALS"
id = "abc123def456789..."          # ← Same IDs for prod (or create separate prod namespace)
preview_id = "xyz789abc123456..."
```

### Football Worker
Edit `workers/football-espn-mcp/wrangler.jsonc` with the **same namespace IDs** (both workers share the same credential storage):

```toml
[[kv_namespaces]]
binding = "CF_KV_CREDENTIALS"
id = "abc123def456789..."          # ← Same namespace ID
preview_id = "xyz789abc123456..."   # ← Same preview ID

# Update dev and prod environments the same way
```

## Step 3: Generate Encryption Key

Generate a secure base64 encryption key:

```bash
openssl rand -base64 32
```

**Example Output:**
```
kX8mZpK4vJ2qW9nE7RtY3sA1bC5dF6gH8iL0mN9oP2uV
```

**Important:** Save this key securely - you'll use it for both workers and the Next.js app.

## Step 4: Store Secrets in Cloudflare

Set the encryption key as a secret in both workers:

### Baseball Worker
```bash
cd workers/baseball-espn-mcp
wrangler secret put CF_ENCRYPTION_KEY
# Paste your base64 key when prompted

wrangler secret put CLERK_SECRET_KEY
# Paste your Clerk secret key when prompted
```

### Football Worker
```bash
cd workers/football-espn-mcp
wrangler secret put CF_ENCRYPTION_KEY
# Paste the SAME base64 key when prompted

wrangler secret put CLERK_SECRET_KEY
# Paste the SAME Clerk secret key when prompted
```

### Optional: Development Fallback Credentials
For local development only, you can set fallback ESPN credentials:

```bash
# In either worker directory
wrangler secret put ESPN_S2
# Paste your ESPN S2 cookie value

wrangler secret put ESPN_SWID
# Paste your ESPN SWID cookie value
```

## Step 5: Test Local Development

Start both workers locally to test KV connectivity:

### Terminal 1 - Baseball Worker
```bash
cd workers/baseball-espn-mcp
wrangler dev --env dev
```

### Terminal 2 - Football Worker
```bash
cd workers/football-espn-mcp
wrangler dev --env dev
```

### Test Health Endpoints
```bash
# Test baseball worker (usually port 8787)
curl http://localhost:8787/health

# Test football worker (usually port 8788) 
curl http://localhost:8788/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "service": "baseball-espn-mcp", 
  "version": "4.0.0",
  "timestamp": "2024-12-26T01:30:00.000Z"
}
```

## Step 6: Configure Next.js App

Create or update your Next.js environment file:

```bash
cd openai
cp ENV_SAMPLE .env.local  # or create .env.local if ENV_SAMPLE doesn't exist
```

Add the encryption key to `.env.local`:

```bash
# Required for credential encryption/decryption
CF_ENCRYPTION_KEY=kX8mZpK4vJ2qW9nE7RtY3sA1bC5dF6gH8iL0mN9oP2uV

# Optional: Worker URLs for local development
NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL=http://localhost:8787
NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL=http://localhost:8788

# Your existing variables
OPENAI_API_KEY=sk-your-key-here
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your-key-here
CLERK_SECRET_KEY=sk_test_your-key-here
```

## Step 7: Test End-to-End Flow

1. **Start all services:**
   ```bash
   # Terminal 1: Baseball worker
   cd workers/baseball-espn-mcp && wrangler dev --env dev

   # Terminal 2: Football worker  
   cd workers/football-espn-mcp && wrangler dev --env dev

   # Terminal 3: Next.js app
   cd openai && npm run dev
   ```

2. **Test the onboarding flow:**
   - Go to `http://localhost:3000`
   - Log in with Clerk
   - Navigate to onboarding → ESPN credentials
   - Enter your SWID and S2 values
   - Click save

3. **Verify storage:**
   If successful, you should see a success message and the credentials will be encrypted and stored in KV.

## Step 8: Deploy to Production

Once local testing works, deploy to production:

```bash
# Deploy baseball worker
cd workers/baseball-espn-mcp
wrangler deploy --env prod

# Deploy football worker
cd workers/football-espn-mcp  
wrangler deploy --env prod

# Deploy Next.js app (example for Cloudflare Pages)
cd openai
npm run build
# Follow your preferred deployment method
```

## Troubleshooting

### Common Issues

**"Cannot find KV namespace"**
- Check that your namespace IDs in wrangler.jsonc match the output from step 1
- Ensure you're using the correct environment (dev/prod)

**"Encryption failed"**
- Verify CF_ENCRYPTION_KEY is set in both workers and Next.js
- Ensure the same key is used everywhere

**"Health check fails"**
- Check that wrangler dev is running on expected ports
- Verify KV binding is working with `wrangler kv:key list --binding CF_KV_CREDENTIALS`

### Verification Commands

```bash
# List KV keys (will show encrypted credential keys)
wrangler kv:key list --binding CF_KV_CREDENTIALS

# Check worker logs
wrangler tail baseball-espn-mcp-dev

# Test MCP endpoints
curl -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list"}'
```

## Next Steps

Once KV setup is complete:
- Follow the main deployment guide in `docs/DEPLOYMENT.md`
- Configure MCP endpoints for external AI assistants
- Set up monitoring and logging as needed

## Security Notes

- KV storage provides encryption at rest
- Additional AES-GCM encryption is applied before storing credentials
- Encryption keys are stored securely in Cloudflare Secrets
- Never commit encryption keys or credentials to version control