# FLAIM Terminology Refactor Plan

> **Status**: Planning
> **Date**: 2025-07-14
> **Objective**: Systematically refactor all environment-related terminology across the entire codebase to a single, industry-standard convention: `dev`, `preview`, and `prod`.

---

## 1. Analysis and Findings

A full-codebase analysis has revealed inconsistent and ambiguous terminology for deployment environments. Terms like "local", "local dev", "remote dev", and "deploy-prod" are used interchangeably, leading to confusion in documentation, scripts, and configuration.

The most significant finding is the widespread use of `NODE_ENV=development` to control production-critical security features (e.g., disabling credential fallbacks). This is a dangerous pattern. The new terminology will introduce a clear, explicit `ENVIRONMENT` variable (`dev`, `preview`, `prod`) to control application behavior, while `NODE_ENV` will be used strictly for its intended purpose: controlling build and dependency optimizations (`development` vs. `production`).

## 2. The New Standard

The following terminology will be adopted across the entire FLAIM platform:

| New Term  | Environment Type      | Description                                                                                             | `NODE_ENV` Setting |
| :-------- | :-------------------- | :------------------------------------------------------------------------------------------------------ | :----------------- |
| **`dev`**     | Local Development     | Running services on a developer's local machine via `start.sh`. Hot-reloading enabled.                 | `development`      |
| **`preview`** | Staging / Remote Dev  | A remote, production-like environment deployed from a non-main branch for testing and review.           | `production`       |
| **`prod`**    | Production            | The live, public-facing application. Deployed exclusively from the `main` branch.                       | `production`       |

---

## 3. Implementation Plan

This refactor will be executed in phases to ensure a safe and verifiable transition.

### Phase 1: Configuration (`wrangler.jsonc` and `.env`)

**Goal**: Establish the new environment variables and configuration structure as the source of truth.

1.  **`wrangler.jsonc` Files:**
    *   **Action**: Update all worker `wrangler.jsonc` files to use a consistent `[env.dev]`, `[env.preview]`, and `[env.prod]` structure.
    *   **Action**: Introduce a new `ENVIRONMENT` variable (`"dev"`, `"preview"`, or `"prod"`) in each `[env]` block.
    *   **Action**: Set `NODE_ENV` to `production` for `preview` and `prod` environments.
    *   **Reason**: To align our configuration with Cloudflare's environment system and decouple our application logic from `NODE_ENV`.

2.  **`.env` Files:**
    *   **Action**: Rename `openai/.env.local` to `openai/.env.development`.
    *   **Action**: Update `.gitignore` to reflect this change.
    *   **Action**: Update `openai/ENV_SAMPLE` to be `openai/.env.sample` and include the new `ENVIRONMENT` variable.
    *   **Reason**: To adopt the standard Next.js file naming for environment variables.

### Phase 2: Core Logic and Source Code

**Goal**: Refactor the application and worker code to use the new `ENVIRONMENT` variable.

1.  **Eliminate `NODE_ENV` for Logic Control:**
    *   **Action**: Search for every instance of `process.env.NODE_ENV === 'development'` in the source code (`auth/`, `workers/`, `openai/`).
    *   **Action**: Replace these checks with `process.env.ENVIRONMENT === 'dev'`.
    *   **Reason**: This is the most critical security fix. It ensures that production-like environments (`preview`) do not use insecure development-only features (like fallback credentials).

2.  **Update Hardcoded URLs:**
    *   **Action**: Remove all hardcoded `http://localhost:*` fallbacks in the source code.
    *   **Action**: The application will now rely on the environment variables defined in `wrangler.jsonc` and `.env.development` to get the correct worker URLs for the current environment.
    *   **Reason**: To centralize configuration and prevent bugs from stale, hardcoded URLs.

### Phase 3: Scripts (`start.sh`, `build.sh`)

**Goal**: Update all developer-facing scripts to use and enforce the new terminology.

1.  **`start.sh` Overhaul:**
    *   **Action**: Refactor all internal logic, user prompts, and help text to use `dev`, `preview`, and `prod`.
    *   **Action**: The script will now pass the correct `--env` flag (`dev`, `preview`, `prod`) to `wrangler` commands.
    *   **Reason**: To make the main developer entry point the primary enforcer of the new standard.

2.  **`build.sh` Simplification:**
    *   **Action**: The `build.sh` script will remain a pure production builder. It will no longer have any environment-specific flags.
    *   **Reason**: To maintain a clean separation of concerns. `build.sh` builds; `start.sh` orchestrates deployments to different environments.

### Phase 4: Documentation

**Goal**: Ensure all documentation is updated to reflect the new, consistent standard.

1.  **Full Documentation Sweep:**
    *   **Action**: Update all Markdown files in `docs/`, `tests/`, and root to use the `dev`, `preview`, `prod` terminology.
    *   **Action**: Update all code snippets, setup guides, and architectural diagrams.
    *   **Reason**: To eliminate confusion and provide a clear, accurate guide for all developers.

---

## 4. Verification and Rollout

1.  **Branching**: All work will be done on a dedicated feature branch (e.g., `refactor/terminology`).
2.  **Staged Commits**: Each phase will be a separate, clean commit to allow for easy review and potential rollback.
3.  **Testing**: After the refactor, a full end-to-end test of all three environments (`dev`, `preview`, `prod`) will be required before merging.
4.  **Pull Request**: The final changes will be submitted as a single pull request for final review.

This plan represents a significant but necessary refactoring to improve the stability, security, and maintainability of the FLAIM platform.
