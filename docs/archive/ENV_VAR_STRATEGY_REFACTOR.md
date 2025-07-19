# Environment Variable & Configuration Strategy Refactor

> **Status**: Proposal | **Author**: Gemini | **Date**: 2025-07-18
>
> A comprehensive plan to simplify and stabilize the environment variable and configuration management for the FLAIM platform, aligning with modern best practices for Next.js and Cloudflare as of July 2025.

## 1. Executive Summary

Our current environment variable management, which relies on complex, brittle shell scripts (`start.sh`, `build.sh`) to dynamically inject variables, is the root cause of our recurring deployment failures. This approach is an anti-pattern that fights against the native configuration models of Next.js and Cloudflare.

This document proposes a full refactor to a simpler, more robust strategy based on **platform-native, file-based conventions**.

**The New Strategy:**

1.  **Frontend (Next.js):** Adopt the standard `.env` file system (`.env.local`, `.env.preview`, `.env.production`) for all environments. This makes configuration explicit and version-controllable.
2.  **Backend (Workers):** Strictly separate `vars` (non-sensitive config) in `wrangler.jsonc` from `secrets` (sensitive keys) managed via the Cloudflare dashboard.
3.  **Deployment:** Radically simplify `start.sh` to be a **local-only** development orchestrator. Remote deployments will be handled by connecting the Cloudflare Pages project to our Git repository, using the Cloudflare UI to manage production and preview variables.

This change will eliminate the entire class of build errors we've been experiencing, increase developer velocity, and improve security.

---

## 2. Problem Analysis: The Anti-Pattern

The core problem is that `start.sh` acts as a fragile, custom CI/CD system.

| Flaw | Description | Consequence |
| :--- | :--- | :--- |
| **Implicit Configuration** | Variables are generated dynamically and exist only during the script's execution. | Impossible to debug without reading complex shell logic. We can't easily see what the build environment looks like. |
| **Brittle & Error-Prone** | A small change to a `jq` query or a file path can break the entire deployment pipeline. | The constant, difficult-to-diagnose build failures we are currently facing. |
| **Bypasses Platform Features** | We are ignoring the robust environment management tools built directly into Cloudflare Pages and Next.js. | We are reinventing the wheel poorly and missing out on the security and stability of the platform. |
| **Security Risk** | Mixing secrets and public keys in shell scripts increases the risk of accidentally exposing a sensitive key in logs or build artifacts. | A secret key could be leaked, compromising our application. |

---

## 3. The Optimal Architecture: Four Pillars of Configuration

We will adopt a clear, four-pillar model for all configuration. This ensures every piece of information has a single, correct place to live.

| Pillar | Technology | Purpose | Environment |
| :--- | :--- | :--- | :--- |
| **1. `.env` Files** | Next.js Standard | **Public, build-time variables** for the frontend (e.g., `NEXT_PUBLIC_*` keys). | All (`.env.local`, `.env.preview`, `.env.production`) |
| **2. `wrangler.jsonc`** | Cloudflare Workers | **Non-sensitive configuration** for workers (e.g., worker URLs, environment names). | All |
| **3. Cloudflare UI** | Pages & Workers | **Runtime variables** for remote environments. The definitive source of truth for `preview` and `production`. | `preview`, `production` |
| **4. `wrangler secret`** | Cloudflare Workers | **Sensitive keys and secrets** (e.g., API keys, encryption keys). | All |

### 3.1. Frontend: Next.js on Cloudflare Pages

The frontend configuration will be managed entirely through `.env` files.

-   **`openai/.env.local`**: For local development. Contains localhost URLs and test keys. **Ignored by Git.**
-   **`openai/.env.preview`**: Contains public keys and settings for the `preview` environment. **Committed to Git.**
-   **`openai/.env.production`**: Contains public keys and settings for the `production` environment. **Committed to Git.**

The `start.sh` script will be modified to simply use these files instead of generating variables. For remote deployments, the Cloudflare Pages build system will use these files automatically.

### 3.2. Backend: Cloudflare Workers

Worker configuration will be simplified and clarified.

-   **`workers/*/wrangler.jsonc`**: Will contain `vars` for non-sensitive data, like the URL of the `auth-worker`.
-   **`wrangler secret put`**: Will remain the **only** method for managing `CLERK_SECRET_KEY`, `OPENAI_API_KEY`, and `CF_ENCRYPTION_KEY`.

### 3.3. Workers CI/CD: GitHub Actions with `wrangler-action`

To keep remote Worker deployments reproducible, we will adopt the official **`cloudflare/wrangler-action`** GitHub Action.

```yaml
# .github/workflows/worker-deploy.yml
name: Deploy Workers
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        worker:
          - auth-worker
          - baseball-espn-mcp
          - football-espn-mcp
    steps:
      - uses: actions/checkout@v4
      - name: Deploy ${{ matrix.worker }}
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: workers/${{ matrix.worker }}
          command: deploy --env production
```

Key points:
- `apiToken` is a **scoped API token** ("Account → API Tokens → Edit Cloudflare Workers") stored in GitHub Secrets.
- Preview deployments: add a second job that runs `deploy --env preview` when the event is `pull_request`.
- This eliminates hand-run Wrangler commands and keeps prod locked to `main`.

### 3.4. Cloudflare Pages Variable Precedence

Cloudflare Pages resolves environment variables in the following order (highest → lowest):
1. Variables set in the UI for the matching branch (e.g., preview/*).
2. Variables set in the UI for production.
3. Values committed in `.env.*` files.

Best practices:
- Commit **only public `NEXT_PUBLIC_*` variables**. Store everything else in the Pages UI.
- Scope preview-only values to branch pattern `preview/*` so prod remains untouched.
- Never place secrets in `.env.preview` or `.env.production` — they are version-controlled.

---

## 4. Implementation Plan

This is a step-by-step plan to execute the refactor.

### Phase 1: Create Explicit Configuration Files

1.  **Create `.env` files** in the `openai/` directory:
    *   `touch openai/.env.local`
    *   `touch openai/.env.preview`
    *   `touch openai/.env.production`

2.  **Populate the new `.env` files** with the required public keys.
    *   **`openai/.env.preview`:**
        ```env
        # Public variables for the Preview environment
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_YOUR_PREVIEW_KEY
        ENVIRONMENT=preview
        ```
    *   **`openai/.env.production`:**
        ```env
        # Public variables for the Production environment
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_YOUR_PRODUCTION_KEY
        ENVIRONMENT=prod
        ```

3.  **Create `.env.example`** to guide new developers.
    *   **`openai/.env.example`:**
        ```env
        # Example for .env.local
        OPENAI_API_KEY="sk-..."
        CLERK_SECRET_KEY="sk_test_..."
        CF_ENCRYPTION_KEY="..."
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
        ENVIRONMENT=dev
        ```

4.  **Update `.gitignore`** to ensure `.env.local` is never committed.
    ```gitignore
    # Add to root .gitignore
    .env.local
    openai/.env.local
    ```

### Phase 2: Radically Simplify `start.sh` and `build.sh`

1.  **Remove all remote deployment logic from `start.sh`**. Its only job will be to run the `dev` environment locally.
2.  **Remove all dynamic variable generation from `start.sh`**. It will no longer create `.env.production` or export variables.
3.  **Modify `build.sh`** to remove the environment variable checks, as Next.js will now handle this automatically via the `.env` files.

### Phase 3: Configure Cloudflare for GitOps

1.  **Connect the Cloudflare Pages project to your GitHub repository.**
2.  **Configure Build & Deployments in the Cloudflare UI:**
    *   **Production Branch:** `main`
    *   **Preview Branches:** `preview`, `dev`, or `*`
    *   **Build Command:** `npm run build`
    *   **Build Output Directory:** `openai/.vercel/output/static`
3.  **Set Environment Variables in the Cloudflare UI:**
    *   Go to `Settings` > `Environment variables`.
    *   Add the production values for `NEXT_PUBLIC_AUTH_WORKER_URL`, etc.
    *   Add the preview values and associate them with the `preview` branch.
    *   Add all required secrets (`CLERK_SECRET_KEY`, etc.) as encrypted variables.
4.  **Set up the GitHub Action for Worker deployments** described in section 3.3 so that Workers are deployed automatically on push / PR events.

### Phase 4: Update Documentation

1.  **Update `README.md` and `docs/GETTING_STARTED.md`** to reflect the new, simpler workflow:
    *   "To deploy to production, merge your changes to the `main` branch."
    *   "To deploy a preview, create a pull request or push to a `preview` branch."
    *   "For local development, copy `.env.example` to `.env.local` and run `./start.sh`."

---

## 5. Benefits of This New Architecture

*   **Simplicity:** The deployment process becomes "git push". The configuration is explicit and easy to read.
*   **Robustness:** We are using the battle-tested, native systems provided by Next.js and Cloudflare, eliminating our custom, brittle scripts.
*   **Security:** Secrets are handled exclusively by Cloudflare's secure secret store. The attack surface for leaks is dramatically reduced.
*   **Developer Velocity:** Developers no longer need to understand complex shell scripts. They can focus on writing code, and the deployment "just works".

This refactor represents a significant step forward in the maturity and stability of the FLAIM platform. It is the correct, long-term solution to the problems we are facing.
