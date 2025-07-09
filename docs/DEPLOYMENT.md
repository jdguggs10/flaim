# FLAIM Platform Deployment Guide v6.1

This guide covers the deployment process for the FLAIM platform, focusing on the recommended Cloudflare Pages workflow for the Next.js frontend and the deployment of its supporting Cloudflare Workers.

## 🚀 Quick Start: Interactive Deployment

For most scenarios, the interactive launcher and build script provide the simplest and most reliable way to manage deployments.

```bash
git clone https://github.com/yourusername/flaim
cd flaim

# Use the interactive build script for local, dev, and prod deployments
./build.sh
```

The `build.sh` script now handles all frontend deployment scenarios:
- **Local Dev Preview**: Builds the frontend and serves it locally with `wrangler pages dev`.
- **Remote Dev Deploy**: Deploys the frontend to the `dev` branch on Cloudflare Pages.
- **Remote Prod Deploy**: Deploys the frontend to the `main` branch on Cloudflare Pages.

---

## Frontend Deployment: Cloudflare Pages

The FLAIM frontend is a Next.js application optimized for deployment on Cloudflare Pages using the `@cloudflare/next-on-pages` adapter.

### 1. Build the Application

The build process is a two-step sequence that creates a standard Next.js build and then adapts it for Cloudflare's Edge runtime.

```bash
# Navigate to the frontend directory
cd openai

# 1. Install dependencies
npm install

# 2. Run the standard Next.js build
npm run build

# 3. Adapt the build output for Cloudflare Pages
npx next-on-pages
```

Upon completion, the `openai/.vercel/output/static` directory will contain the assets ready for deployment. The `./build.sh` script automates these steps for you.

### 2. Configure `wrangler.jsonc`

For a Cloudflare Pages deployment, the `openai/wrangler.jsonc` file is the single source of truth for configuration. It must **not** contain a `build` section when using direct uploads.

A correct configuration looks like this:

```jsonc
// openai/wrangler.jsonc
{
  "name": "flaim-frontend-dev",
  "compatibility_date": "2025-01-01",
  "pages_build_output_dir": ".vercel/output/static",
  "compatibility_flags": ["nodejs_compat"],

  // Environment variables are defined here
  "vars": {
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY": "pk_test_..."
  },
  "env": {
    "preview": {
      "vars": {
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY": "pk_test_...",
        "NEXT_PUBLIC_AUTH_WORKER_URL": "https://auth-worker-dev.your-account.workers.dev",
        "NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL": "https://baseball-espn-mcp-dev.your-account.workers.dev",
        "NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL": "https://football-espn-mcp-dev.your-account.workers.dev"
      }
    },
    "production": {
      "vars": {
        // Add production worker URLs here
      }
    }
  }
}
```

### 3. Configure Environment Variables & Secrets

Cloudflare Pages uses two methods for managing environment variables:

**A. Plaintext Variables (in `wrangler.jsonc`)**
- Any non-sensitive, public variables (e.g., `NEXT_PUBLIC_*`) **must** be defined in `openai/wrangler.jsonc` under the `vars` block, as shown above.
- When this file is present, the Cloudflare dashboard UI for adding variables will be locked.

**B. Secrets (in Dashboard or CLI)**
- Sensitive values (`OPENAI_API_KEY`, `CLERK_SECRET_KEY`, `CF_ENCRYPTION_KEY`) **must** be configured as secrets.
- Use the `wrangler pages secret put` command or the Cloudflare dashboard.

```bash
# Example of setting a secret for the preview environment
wrangler pages secret put CLERK_SECRET_KEY --env preview
```

### 4. Deploy to Cloudflare Pages

Once the build is complete and `wrangler.jsonc` is configured, deploy using the `wrangler pages deploy` command, pointing to the correct output directory.

```bash
# Create the Pages project once
wrangler pages project create flaim-frontend-dev

# Deploy to a preview branch (e.g., 'dev')
wrangler pages deploy .vercel/output/static \
  --project-name flaim-frontend-dev \
  --branch dev

# Deploy to production (points to the 'main' branch)
wrangler pages deploy .vercel/output/static \
  --project-name flaim-frontend-dev \
  --branch main
```

The `./build.sh` script automates these deployment commands with the `--remote-dev` and `--remote-prod` flags.

### 5. Edge Runtime Requirement

For the `@cloudflare/next-on-pages` adapter to function correctly, all Next.js API routes must be configured to run on the Edge Runtime.

Ensure every route file under `openai/app/api/` includes the following export:

```typescript
// e.g., in openai/app/api/chat/route.ts
export const runtime = 'edge';
```

---

## Worker Deployment

The `auth-worker` and sport-specific MCP workers are deployed as standard Cloudflare Workers. The `start.sh` script provides an interactive way to deploy them.

### Manual Worker Deployment

1.  **Navigate to the worker directory**:
    ```bash
    cd workers/auth-worker
    ```
2.  **Configure `wrangler.jsonc`**: Ensure the `name` and other properties are set correctly for your environment.
3.  **Set Secrets**:
    ```bash
    # Generate a 32-byte key for encryption
    openssl rand -base64 32

    # Set secrets for the worker
    wrangler secret put CF_ENCRYPTION_KEY
    wrangler secret put CLERK_SECRET_KEY
    ```
4.  **Deploy**:
    ```bash
    # Deploy to a dev environment
    wrangler deploy --name auth-worker-dev

    # Deploy to production
    wrangler deploy --name auth-worker-prod
    ```

Repeat this process for the `baseball-espn-mcp` and `football-espn-mcp` workers.

---

## Monitoring & Troubleshooting

### Health Checks
After deployment, verify that all services are running.
```bash
# Check a worker's health
curl https://auth-worker-dev.your-account.workers.dev/health

# Check the frontend URL
# (e.g., https://dev.flaim-frontend-dev.pages.dev)
```

### Common Issues
- **500 Errors on Frontend**: This is most often caused by missing or incorrect `NEXT_PUBLIC_*` environment variables in `wrangler.jsonc`. Verify that the URLs for your deployed workers are correct for the given environment (e.g., `preview` or `production`).
- **Build Failures**: Ensure `@cloudflare/next-on-pages` is installed and that all API routes have `export const runtime = 'edge';`.
- **Wrangler Errors**: Make sure you are using Wrangler v4.0 or later.
