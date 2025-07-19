# Unified Deployment & Configuration Strategy

> **Status**: Final Proposal | **Author**: Gemini | **Date**: 2025-07-18
>
> This document presents the definitive, unified strategy for FLAIM's deployment and configuration. It synthesizes the `ENV_VAR_STRATEGY_REFACTOR` and `VERCEL_CONVERSION` proposals into a single, optimal path forward that prioritizes stability, simplicity, and a first-class developer experience on a fully Cloudflare-native stack.

## 1. Executive Decision: A Unified Cloudflare-Native Architecture

After a thorough analysis of our recent build failures and a review of all proposals, the decision is to **reject the Vercel migration** and instead **double down on a streamlined, GitOps-driven, Cloudflare-native architecture.**

-   **Problem:** Our custom shell scripts (`start.sh`, `build.sh`) are a brittle, error-prone anti-pattern that fights the native capabilities of our chosen platforms (Next.js and Cloudflare).
-   **Solution:** We will completely eliminate our custom deployment logic and adopt the standard, platform-native workflows for environment configuration and deployment. This involves using `.env` files for Next.js and leveraging Cloudflare's own Git integration for deployments.

This strategy provides the developer experience benefits sought in the Vercel proposal (e.g., automatic previews) without the architectural complexity, cost, and potential latency of a split-vendor stack.

---

## 2. The New Architecture: GitOps is the Engine

Our entire deployment lifecycle will be automated and driven by Git events. The brittle, manual steps are eliminated.

| Environment | Trigger | Action | Technologies Used |
| :--- | :--- | :--- | :--- |
| **Local Dev** | `npm run dev` | Starts Next.js and all Workers locally. | `concurrently`, `wrangler`, `.env.local` |
| **Preview** | `git push` to a PR branch | Cloudflare automatically builds and deploys the frontend. Workers are deployed via GitHub Actions. | Cloudflare Pages Git Integration, GitHub Actions, `.env.preview` |
| **Production** | `git merge` to `main` | Cloudflare automatically deploys the frontend. Workers are deployed via GitHub Actions. | Cloudflare Pages Git Integration, GitHub Actions, `.env.production` |

### 2.1. The Four Pillars of Configuration

This model, adopted from the previous refactor proposal, remains the foundation of our strategy.

1.  **`.env` Files:** For **public, build-time** frontend variables (`NEXT_PUBLIC_*`).
2.  **`wrangler.jsonc`:** For **non-sensitive** backend configuration (e.g., service bindings).
3.  **Cloudflare UI:** For **runtime** environment variables and secrets for Pages.
4.  **`wrangler secret` / GitHub Secrets:** For all **sensitive** Worker secrets.

---

## 3. The Implementation Plan: A Step-by-Step Refactor

### Phase 1: Establish the New Configuration Foundation

1.  **Create Explicit `.env` Files:** In the `openai/` directory, create the following:
    *   `openai/.env.local` (for local secrets, ignored by Git)
    *   `openai/.env.preview` (for preview-specific public keys, committed to Git)
    *   `openai/.env.production` (for production-specific public keys, committed to Git)
    *   `openai/.env.example` (to guide developers)

2.  **Populate `.env` files:**
    *   **`.env.preview`:**
        ```env
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_YOUR_PREVIEW_KEY
        ENVIRONMENT=preview
        ```
    *   **`.env.production`:**
        ```env
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_YOUR_PRODUCTION_KEY
        ENVIRONMENT=prod
        ```

3.  **Update `.gitignore`:** Ensure `openai/.env.local` and `.dev.vars` are ignored.

### Phase 2: Overhaul the Tooling

1.  **Eliminate `start.sh` and `build.sh`:** These scripts are the source of our problems. They will be deleted.
    ```bash
    rm start.sh build.sh
    ```

2.  **Update `package.json` with Modern Scripts:** We will use `npm` as the single entry point for developers, powered by `concurrently` to manage local processes.

    *   **Install `concurrently`:**
        ```bash
        npm install --save-dev concurrently
        ```
    *   **Update `scripts` in the root `package.json`:**
        ```json
        "scripts": {
          "dev": "concurrently \"npm:dev:frontend\" \"npm:dev:workers\"",
          "dev:frontend": "cd openai && npm run dev",
          "dev:workers": "cd workers && wrangler dev --env dev",
          "build": "cd openai && npm run build",
          "deploy:workers:preview": "cd workers && wrangler deploy --env preview",
          "deploy:workers:prod": "cd workers && wrangler deploy --env prod"
        },
        ```

### Phase 3: Implement GitOps for CI/CD

1.  **Configure Cloudflare Pages:**
    *   In the Cloudflare dashboard, connect the Pages project to the GitHub repository.
    *   **Production Branch:** `main`
    *   **Build Command:** `npm run build`
    *   **Build Output Directory:** `openai/.vercel/output/static`
    *   **Environment Variables:**
        *   Add `NEXT_PUBLIC_AUTH_WORKER_URL`, etc., for both Production and Preview environments.
        *   Add all secrets (`CLERK_SECRET_KEY`, `OPENAI_API_KEY`) as encrypted variables.

2.  **Create GitHub Actions for Worker Deployments:** Create a new workflow file at `.github/workflows/deploy-workers.yml`.

    ```yaml
    name: Deploy Cloudflare Workers

on:
      push:
        branches:
          - main
      pull_request:

    jobs:
      deploy_workers:
        runs-on: ubuntu-latest
        strategy:
          matrix:
            worker: ['auth-worker', 'baseball-espn-mcp', 'football-espn-mcp']

        steps:
          - uses: actions/checkout@v4

          - name: Deploy to Production
            if: github.ref == 'refs/heads/main'
            uses: cloudflare/wrangler-action@v3
            with:
              apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
              accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
              workingDirectory: workers/${{ matrix.worker }}
              command: deploy --env prod

          - name: Deploy to Preview
            if: github.event_name == 'pull_request'
            uses: cloudflare/wrangler-action@v3
            with:
              apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
              accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
              workingDirectory: workers/${{ matrix.worker }}
              command: deploy --env preview
    ```

### Phase 4: Finalize and Document

1.  **Remove Cloudflare Adapter:** Since Vercel is not being used and Cloudflare Pages has native Next.js support, the `@cloudflare/next-on-pages` adapter is no longer necessary. It can be removed to simplify the build process.
    ```bash
    npm uninstall @cloudflare/next-on-pages
    ```

2.  **Update Documentation:** Update `README.md` and `GETTING_STARTED.md` to reflect the new, vastly simplified workflow.
    *   **Local Dev:** `npm run dev`
    *   **Deployment:** "Push to a PR to create a preview. Merge to `main` to deploy to production."

---

## 4. Conclusion: A Stable, Modern Foundation

This unified strategy provides a clear, robust, and maintainable path forward. By removing our custom script-based deployment logic and embracing the native GitOps workflows of our chosen platforms, we will:

*   **Eliminate** the entire category of build and configuration errors that have plagued this project.
*   **Simplify** the developer workflow to a single command (`npm run dev`).
*   **Increase** security by strictly separating configuration and secrets.
*   **Accelerate** development velocity by providing fast, automatic preview deployments.

This is the definitive solution to our current problems and the correct foundation for the future of FLAIM.
