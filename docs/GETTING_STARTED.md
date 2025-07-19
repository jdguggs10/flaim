# Getting Started & Deployment Guide

This guide is the single source of truth for setting up, configuring, and deploying the FLAIM platform across all three environments: `dev` (local), `preview`, and `prod` (production).

## What is FLAIM?

FLAIM (Fantasy League AI Manager) is your AI-powered fantasy sports assistant with modular authentication, usage limits, and multi-sport ESPN integration through MCP (Model Context Protocol) tools.

Instead of juggling multiple apps and spreadsheets, you can ask natural language questions like:
- *"How did my team perform this week?"*
- *"Who should I start at shortstop today?"*
- *"Analyze this trade proposal for me"*

---

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

- **Node.js v20 (LTS)**: Required for consistent builds.
- **npm**: Comes bundled with Node.js.
- **Wrangler CLI**: The command-line tool for Cloudflare Workers.
  - **Installation**: `npm install -g wrangler`

---

## Deployment & Configuration

FLAIM uses a GitOps workflow for all deployments. The complex `start.sh` script has been removed in favor of standard npm commands and Cloudflare's native Git integration.

### Environment Breakdown

| Environment | `ENVIRONMENT` Var | `NODE_ENV`   | Description                                             |
| :---------- | :---------------- | :----------- | :------------------------------------------------------ |
| **`dev`**       | `dev`             | `development`| For local development, using `npm run dev`.             |
| **`preview`**   | `preview`         | `production` | Deployed automatically from pull requests.              |
| **`prod`**      | `prod`            | `production` | Deployed automatically from the `main` branch.          |

### Environment Variables & Secrets

#### Local (`dev`)
- **File**: `openai/.env.local` (create this from `openai/.env.example`).
- **Secrets**: All secrets (OpenAI, Clerk, etc.) are managed in this file for local development.

#### Preview & Production (`preview` / `prod`)
- **Frontend**: All variables and secrets are managed in the Cloudflare Pages project settings (`Settings` > `Environment variables`).
- **Workers**: Secrets are managed using the `wrangler secret put` command for each worker and environment.

First, generate a secure encryption key:
```bash
# Generate a secure 32-byte encryption key
openssl rand -base64 32
```

Then, set the secrets for each worker:
```bash
# Example: Set secrets for the auth-worker in the 'preview' environment
cd workers/auth-worker
wrangler secret put CF_ENCRYPTION_KEY --env preview
wrangler secret put CLERK_SECRET_KEY --env preview

# Repeat for other workers and the 'prod' environment as needed.
```

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

Frontend deployment is handled **automatically** by Cloudflare Pages when you push to a pull request (for previews) or merge to the `main` branch (for production).

---

## Verification

After deployment, you can verify the services are running correctly using health checks.

```bash
# Local development
curl http://localhost:8786/health # auth-worker
curl http://localhost:8787/health # baseball-worker
curl http://localhost:8788/health # football-worker
curl http://localhost:3000        # frontend

# Preview environment (replace with your actual URLs)
curl https://auth-worker-preview.your-domain.workers.dev/health
curl https://preview.flaim.pages.dev

# Production
curl https://auth-worker.flaim.app/health
curl https://flaim.app
```

---

## FAQ & Troubleshooting

### Build & Deployment Issues

- **Why were `start.sh` and `build.sh` removed?**
  - They were replaced with a modern GitOps workflow using standard `npm` scripts and Cloudflare's native Git integration. This new system is more reliable, secure, and easier to maintain. See `docs/MIGRATION_TO_GITOPS.md` for details.

- **How do I deploy now?**
  - Create a pull request to deploy a preview. Merge to `main` to deploy to production. The system is now fully automated.

- **Where do my environment variables go?**
  - For local development, they go in `openai/.env.local`. For remote environments, they are set in the Cloudflare Pages UI for the frontend and via `wrangler secret put` for the workers.

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
  - **`SWID` / `espn_s2`**: User-specific cookies that are stored encrypted in Cloudflare KV.
  - **Kona headers**: Required by ESPN's edge servers to return JSON instead of HTML.

---

## Next Steps

1.  **Custom Domains**: See `docs/dev/FLAIM_APP_DOMAIN_MIGRATION.md` for production domain setup.
2.  **Monitoring**: Set up Cloudflare Analytics and Worker logs for your deployed services.
3.  **CI/CD**: The new CI/CD pipeline is already configured in `.github/workflows/deploy-workers.yml`.