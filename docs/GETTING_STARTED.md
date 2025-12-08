# Getting Started & Deployment Guide

This guide is the single source of truth for setting up, configuring, and deploying the FLAIM platform across all three environments: `dev` (local), `preview`, and `prod` (production).


## Quick Start (5 Minutes)

This will get you up and running with a local development environment.

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/flaim
cd flaim

# 2. Install dependencies
npm install

# 3. Set up local environment variables
cp openai/.env.example openai/.env.local

# 4. Add your secret keys to openai/.env.local
#    (OPENAI_API_KEY, CLERK_SECRET_KEY, etc.)

# 5. Start all services for local development
npm run dev
```

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js v22**: Required for consistent builds.
- **npm**: Comes bundled with Node.js.
- **Wrangler CLI**: The command-line tool for Cloudflare Workers.
  - **Installation**: `npm install -g wrangler`

---

## User Onboarding Flow

Understanding the complete onboarding flow is critical for debugging and extending FLAIM. Here's how a user progresses from signup to using the AI assistant:

### Step 1: Authentication (Clerk)
- User visits the site and signs in/up via Clerk
- Clerk establishes user identity with a unique `userId`
- Frontend receives Clerk session with JWT token

### Step 2: ESPN Credentials Setup
- User navigates to ESPN credential input page
- User provides their ESPN `SWID` and `espn_s2` cookies
- Frontend calls `/api/auth/espn/credentials` (POST)
- Vercel API route forwards request to auth-worker with Clerk JWT
- Auth-worker stores credentials in Supabase `espn_credentials` table, keyed by Clerk `userId`

### Step 3: League Selection
- User inputs league IDs for their fantasy leagues (baseball, football, etc.)
- Frontend calls `/api/auth/espn/leagues` (POST)
- Vercel API route forwards to auth-worker
- Auth-worker stores league data in Supabase `espn_leagues` table, linked to user's Clerk ID

### Step 4: Auto-Pull League Details
- User clicks "Setup League" to fetch additional league metadata
- Frontend calls `/api/onboarding/espn/auto-pull` (POST) with `{sport, leagueId}`
- Vercel route determines which sport worker to call (baseball/football)
- Vercel forwards request to sport worker's `/onboarding/initialize` endpoint
- **Sport worker flow:**
  1. Receives Clerk userId and JWT via headers
  2. Calls auth-worker `/credentials/espn` to retrieve ESPN cookies
  3. Calls auth-worker `/leagues` to retrieve user's leagues
  4. Calls ESPN API with credentials to fetch league name, standings, teams
  5. Returns enriched league data to frontend
- Frontend displays league details and completes onboarding

### Critical Architecture Notes

**Worker-to-Worker Communication:**
- MCP workers (baseball, football) call auth-worker internally
- These internal calls MUST use direct `.workers.dev` URLs
- Custom domain routes (`api.flaim.app/*`) are for external clients only

**External Client Communication:**
- Frontend (Vercel) calls workers via custom domain routes
- These use `https://api.flaim.app/auth`, `https://api.flaim.app/baseball`, etc.

**Why This Matters:**
- Custom domain routes add path prefixes and may require additional auth
- Worker-to-worker calls with custom domains can cause timeouts or routing loops
- Always use direct worker URLs for internal communication

---

## Deployment & Configuration

FLAIM uses a GitOps workflow for all deployments. The complex `start.sh` script has been removed in favor of standard npm commands and Vercel's native Git integration for the frontend.

### Environment Breakdown

| Environment | `ENVIRONMENT` Var | `NODE_ENV`   | Description                                             |
| :---------- | :---------------- | :----------- | :------------------------------------------------------ |
| **`dev`**       | `dev`             | `development`| For local development, using `npm run dev`.             |
| **`preview`**   | `preview`         | `production` | Deployed automatically from pull requests.              |
| **`prod`**      | `prod`            | `production` | Deployed automatically from the `main` branch.          |

### Environment Variables & Secrets

#### Local (`dev`)
For local development, secrets are managed in two separate files: one for the frontend and one for the backend workers.

1.  **Frontend Secrets (`openai/.env.local`)**
    -   **Purpose**: Provides secrets and public keys to the Next.js application.
    -   **Setup**: Copy `openai/.env.example` to `openai/.env.local` and add your keys.

2.  **Backend Secrets (`.env.local` in openai directory)**
    -   **Purpose**: Provides secrets to the Cloudflare Workers during local development.
    -   **Setup**: Add Supabase credentials to `openai/.env.local` (e.g., `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`).

#### Preview & Production (`preview` / `prod`)
- **Frontend**: All variables and secrets are managed in the Vercel project settings (`Settings` > `Environment Variables`).
- **Workers**: Secrets MUST be set via **Cloudflare Dashboard** (`Workers & Pages` > `[worker-name]` > `Settings` > `Variables and Secrets`).

**Critical:** For production workers with custom routes, secrets cannot be set via `wrangler secret put`. Use the Cloudflare dashboard:

1. Go to **Cloudflare Dashboard** → **Workers & Pages** → Select worker
2. Click **Settings** → **Variables and Secrets** → **Add variable**
3. Set type to **Secret** (encrypted) for sensitive values
4. Required secrets for **auth-worker**:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `CLERK_SECRET_KEY`
5. Changes take effect immediately (no redeploy needed)

### Complete Environment Variable Reference

#### Next.js Frontend (Required)
```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Worker URLs - MUST include https:// and NO trailing wildcards
NEXT_PUBLIC_AUTH_WORKER_URL=https://api.flaim.app/auth
NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL=https://api.flaim.app/baseball
NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL=https://api.flaim.app/football

# Optional Clerk URLs
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

**Common Mistake:** Do NOT include route wildcards (`/*`) in worker URLs. These are used in Cloudflare route config, not environment variables:
- ❌ Wrong: `api.flaim.app/auth/*` or `api.flaim.app/auth`
- ✅ Correct: `https://api.flaim.app/auth`

#### Auth Worker (Required)
```bash
# Required for Supabase integration
SUPABASE_URL=https://your-project-ref.supabase.co
# Use your "Secret Key" (sb_secret_...) for new projects (post-May 2025)
SUPABASE_SERVICE_KEY=sb_secret_...

# Required for production security
CLERK_SECRET_KEY=sk_test_your-clerk-secret-key

# Environment configuration (set via wrangler.jsonc)
NODE_ENV=production  # or "development"
ENVIRONMENT=prod     # or "preview", "dev"
```

#### MCP Workers (Baseball/Football) (Required)
```bash
# Required for auth-worker communication
# CRITICAL: Use direct .workers.dev URL, NOT custom domain
AUTH_WORKER_URL=https://auth-worker.YOUR-ACCOUNT.workers.dev

# Optional for Clerk verification
CLERK_SECRET_KEY=sk_test_your-clerk-secret-key

# Environment configuration (set via wrangler.jsonc)
NODE_ENV=production  # or "development"
ENVIRONMENT=prod     # or "preview", "dev"
```

**CRITICAL - Worker-to-Worker URLs:**
- `AUTH_WORKER_URL` MUST use the direct `.workers.dev` URL
- ❌ WRONG: `https://api.flaim.app/auth` (custom domain - causes timeouts)
- ✅ CORRECT: `https://auth-worker.YOUR-ACCOUNT.workers.dev`
- Custom domains are for external clients only (Vercel frontend)
- Worker-to-worker calls need direct URLs to avoid routing overhead
- **IMPORTANT**: Auth-worker production config MUST have `"workers_dev": true` in wrangler.jsonc to enable the `.workers.dev` URL alongside custom domain routes

---

## DNS Setup for Custom Worker Routes

To use custom domain routes (e.g., `api.flaim.app/auth/*`), configure DNS in Cloudflare:

1. **Cloudflare Dashboard** → **DNS** → **Records**
2. Click **Add record** with these settings:
   - **Type**: `A` (IPv4)
   - **Name**: `api` (creates `api.flaim.app`)
   - **IPv4 address**: `192.0.2.1` (dummy IP, actual routing handled by Workers)
   - **Proxy status**: **Proxied** (orange cloud) ← **Critical!**
   - **TTL**: Auto

3. DNS propagates in 1-5 minutes
4. Verify: `curl https://api.flaim.app/auth/health`

**Why dummy IP?** When proxied through Cloudflare, the Workers route configuration intercepts requests before they reach the IP. The orange cloud (proxied) setting is what makes routing work.

---

## Manual Deployment

Manual deployments are now only necessary for the workers if you need to deploy outside of the standard GitOps workflow.

### Deploy Workers Manually

```bash
# Deploy all workers to the preview environment
npm run deploy:workers:preview

# Deploy all workers to the production environment
npm run deploy:workers:prod
```

### Frontend Deployment

Frontend deployment is handled **automatically** by Vercel when you push to a pull request (for previews) or merge to the `main` branch (for production). The frontend is deployed to `flaim.app`.

---

## CI/CD & GitHub Actions

The project uses a restored GitHub Actions workflow (`.github/workflows/deploy-workers.yml`) to automate worker deployments.

### 1. Required GitHub Secrets
To enable automated deployments, you must add the following secrets to your GitHub repository (**Settings** > **Secrets and variables** > **Actions**):

- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID.
- `CLOUDFLARE_API_TOKEN`: An API Token with "Edit Cloudflare Workers" permissions.

### 2. Deployment Workflow
- **Preview**: Open a **Pull Request** to automatically deploy workers to the `preview` environment.
- **Production**: Merge changes to the `main` branch to automatically deploy workers to the `prod` environment.

---

## Verification

Verify deployments with health checks:
- **Local**: `curl http://localhost:8786/health` (auth-worker), `localhost:3000` (frontend)
- **Preview/Prod**: Use your deployed worker URLs + `/health`

---

## FAQ & Troubleshooting

### Production 500 Errors

**Error:** API routes return 500 errors in production, but work locally.

**Common causes:**
1. **Missing Cloudflare secrets** - Check auth-worker has `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CLERK_SECRET_KEY` in Cloudflare Dashboard (not just wrangler.jsonc)
2. **Wrong URL format** - Vercel `NEXT_PUBLIC_AUTH_WORKER_URL` must be `https://api.flaim.app/auth` (not `api.flaim.app/auth/*`)
3. **Missing DNS** - Verify `api.flaim.app` resolves and DNS record is **Proxied** (orange cloud)

**Debug steps:**
1. Test health endpoint: `curl https://api.flaim.app/auth/health`
2. Check Vercel logs for "TypeError: Invalid URL" or auth errors
3. Check Cloudflare Dashboard → Workers → Logs for actual error messages

### Worker Route 404 Errors

**Error:** Worker returns 404 for valid endpoints like `/health`.

**Cause:** Custom domain routes (e.g., `api.flaim.app/auth/*`) add path prefix to requests. Worker receives `/auth/health` but checks for `/health`.

**Fix:** Ensure worker strips route prefix. See `workers/auth-worker/src/index.ts:204-208`:
```typescript
// Strip /auth prefix if present (for custom domain routing)
let pathname = url.pathname;
if (pathname.startsWith('/auth')) {
  pathname = pathname.slice(5) || '/';
}
```

### Onboarding Auto-Pull Timeouts (504 Gateway Timeout)

**Error:** Auto-pull during onboarding times out after 25-30 seconds. Vercel logs show "504 Gateway Timeout" or "Your function was stopped as it did not return an initial response within 25s".

**Cause:** MCP workers (baseball/football) have `AUTH_WORKER_URL` set to custom domain (`https://api.flaim.app/auth`) instead of direct worker URL.

**Why it fails:**
1. Baseball worker calls `AUTH_WORKER_URL/credentials/espn`
2. Custom domain adds routing overhead and may trigger additional auth checks
3. Request hangs or times out waiting for response
4. Vercel edge function hits 25-second limit before sport worker responds

**Fix:**
1. **Enable workers.dev URL on auth-worker**: Edit `workers/auth-worker/wrangler.jsonc` and add `"workers_dev": true` to the `prod` environment config
2. **Update AUTH_WORKER_URL**: Edit `workers/baseball-espn-mcp/wrangler.jsonc` and `workers/football-espn-mcp/wrangler.jsonc`:
   - Change `AUTH_WORKER_URL` from `https://api.flaim.app/auth` to `https://auth-worker.YOUR-ACCOUNT.workers.dev`
3. **Deploy**: Run `npm run deploy:workers:prod` or deploy workers individually with `npx wrangler deploy --env prod`

**Verification:**
```bash
# Test that onboarding endpoint responds quickly (should be < 10 seconds)
curl -X POST https://api.flaim.app/baseball/onboarding/initialize \
  -H "Content-Type: application/json" \
  -H "X-Clerk-User-ID: test" \
  -d '{"sport":"baseball","leagueId":"123"}' \
  --max-time 15
```

**Remember:** Custom domains are for external clients (Vercel frontend) only. Worker-to-worker communication must use direct `.workers.dev` URLs.

### Trailing Slash in Worker URLs

**Error:** Auto-pull returns 404 even though worker is deployed and accessible.

**Cause:** Environment variables have trailing slashes (e.g., `https://api.flaim.app/baseball/`), creating double-slash URLs like `https://api.flaim.app/baseball//onboarding/initialize`.

**Fix:** Remove trailing slashes from all worker URLs in Vercel environment variables:
- ❌ WRONG: `https://api.flaim.app/baseball/`
- ✅ CORRECT: `https://api.flaim.app/baseball`

### Build & Deployment Issues

- **Why were `start.sh` and `build.sh` removed?**
  - They were replaced with a modern GitOps workflow using standard `npm` scripts and Vercel's native Git integration for the frontend. This new system is more reliable, secure, and easier to maintain.

- **How do I deploy now?**
  - Create a pull request to deploy a preview. Merge to `main` to deploy to production. The system is now fully automated.

- **Where do my environment variables go?**
  - For local development, they go in `openai/.env.local`. For remote environments, they are set in the Vercel dashboard for the frontend and via `wrangler secret put` for the workers.

### ESPN API

- **Why do we call `https://lm-api-reads.fantasy.espn.com` instead of the old `fantasy.espn.com/apis/v3` host?**
  - ESPN silently migrated its Fantasy front‑end to the **“League‑Manager API”** (`lm-api-reads`) in 2023‑24. The old host still resolves but increasingly returns 403s or HTML when you request private‑league data. All modern scrapers have switched to the new host.

- **What are the minimum headers required for the ESPN API?**
  ```text
  Cookie: SWID={uuid}; espn_s2={token}
  Accept: application/json
  X-Fantasy-Source: kona
  X-Fantasy-Platform: kona-web-2.0.0
  ```
  - **`SWID` / `espn_s2`**: User-specific cookies that are stored securely in Supabase PostgreSQL.
  - **Kona headers**: Required by ESPN's edge servers to return JSON instead of HTML.

---

## Next Steps

1.  **Custom Domains**: Configure your domain in the Vercel project settings under `Settings` > `Domains`.
2.  **Monitoring**: Use Vercel Analytics for frontend performance and Cloudflare dashboard for Worker logs.
3.  **CI/CD**: The CI/CD pipeline is configured via Vercel's GitHub integration (frontend) and `.github/workflows/deploy-workers.yml` (workers).