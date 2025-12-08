# Changelog

All notable changes to FLAIM will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note on Documentation**: For planning documents related to upcoming or in-progress work, see the `docs/dev` directory. For historical documents, see `docs/archive`.

## [Unreleased]

### Custom Domain Routing & Production Deployment

- **Fixed**: Auth-worker now correctly handles custom domain routes by stripping `/auth` prefix from incoming requests (e.g., `api.flaim.app/auth/health` → checks `/health`)
- **Fixed**: Credential check endpoint returns 200 with `hasCredentials: false` instead of 404 when no credentials exist, eliminating misleading console errors
- **Changed**: Production deployment now requires Cloudflare worker secrets to be set via Dashboard (not `wrangler secret put`) for workers with custom routes
- **Documentation**: Added DNS setup guide, environment variable format requirements, and troubleshooting for common production errors

### ESPN Auth Flow Reliability

- **Fixed**: Correctly detect stored ESPN credentials from auth-worker responses by honoring the `hasCredentials` metadata (with swid/s2 fallback), ensuring the UI can skip credential entry when data already exists.
- **Changed**: Frontend ESPN auth now uses the `/api/auth/espn/credentials` proxy so Clerk JWTs are forwarded server-side instead of hitting auth-worker directly.
- **Security**: Added `https://www.flaim.app` to the auth-worker CORS allowlist to restore production preflight success for the primary hostname.

### Production Security Enhancement - JWT Authentication

- **Security**: **CRITICAL**: Implemented **JWKS-based JWT verification** in auth-worker to eliminate header spoofing vulnerabilities. Production environments now require valid Clerk bearer tokens for all credential operations.
- **Added**: Local JWKS caching (5min TTL) for fast token verification using WebCrypto RS256 signatures.
- **Changed**: MCP workers now forward `Authorization` headers to auth-worker instead of trusting `X-Clerk-User-ID` headers in production.
- **Changed**: Frontend API routes updated to obtain and forward Clerk bearer tokens via `getToken()` calls.
- **Fixed**: Production auth-worker rejects requests without valid JWT tokens, while development maintains header fallback for local iteration.
- **Architecture**: Centralized security model - only auth-worker verifies tokens, MCP workers remain stateless.

### Database Migration & Infrastructure Enhancement

- **Breaking**: Migrated credential storage from Cloudflare KV to **Supabase PostgreSQL** for improved reliability.
- **Added**: ACID transaction guarantees, rich dashboard, real-time monitoring.
- **Removed**: KV dependencies, encryption complexity, retry logic.
- **Changed**: Reduced auth-worker by 31% (714→492 lines), maintained API compatibility.
- **Security**: Simplified architecture eliminates encryption overhead and debugging difficulties.

### Terminology Standardization & Security Enhancement

- **Removed**: The `start.sh` script has been removed in favor of standard `npm` scripts and Cloudflare's native GitOps integration. See `GETTING_STARTED.md` for the new workflow.
- **Changed**: The `GETTING_STARTED.md` guide (formerly `DEPLOYMENT.md`) has been streamlined to be the single source of truth for deployment and configuration.
- **Changed**: Standardized all environment terminology to `dev`, `preview`, and `prod` across the entire codebase, scripts, and documentation.
- **Security**: Fixed a critical vulnerability where `preview` environments could use insecure `development` features. Application logic is now explicitly controlled by the `ENVIRONMENT` variable, not `NODE_ENV`.

## [6.1.0] - 2025-07-08

- **Changed**: Modernized all worker configurations from `wrangler.toml` to `wrangler.jsonc` and updated compatibility dates.
- **Changed**: Upgraded the platform to **React 19.1.0** and **Next.js 15.3.4**.
- **Fixed**: Resolved build failures related to Next.js 15 Route Handler signatures and introduced reusable DTOs in `types/api-responses.ts`.

## [6.0.0] - 2024-12-XX

- **Added**: Introduced a unified, interactive development launcher (`start.sh`) and a deterministic production build script (`build.sh`).
- **Added**: Migrated credential storage from Durable Objects to **Cloudflare KV with AES-GCM encryption**.
- **Changed**: Replaced the development workflow (`start-dev.sh`, `build-prod.sh`) with the new unified scripts.
- **Changed**: The architecture was overhauled to use a centralized `auth-worker`, making sport-specific workers stateless and more secure.

## [4.1.1] - 2024-12-15

- **Added**: **Automatic League Discovery** via ESPN's v3 dashboard API, eliminating the need for manual league ID entry.

## [4.1.0] - 2024-12-14

- **Added**: Extracted a modular `flaim/auth` module for cross-platform authentication.
- **Added**: Introduced multi-sport support with a dedicated Football MCP worker.
- **Changed**: Increased the free tier usage limit from 15 to 100 messages per month.

## [4.0.0] - 2024-12-01

- **Security**: **CRITICAL**: Fixed a header spoofing vulnerability (CVE-2024-FLAIM-001) that could allow credential access impersonation. Implemented server-side Clerk session verification for all sensitive operations.
- **Changed**: Replaced header-based authentication with token-based server-side verification.
- **Deprecated**: Legacy OAuth components and header-based authentication.

## [3.0.0] - 2024-11-15

- **Added**: Integrated **Clerk** for authentication, replacing the previous custom JWT solution.
- **Added**: Introduced a usage tracking system and secure, per-user credential management.
- **Removed**: Simplified the architecture by removing the complex, Stripe-first microservices approach to focus on core functionality.

## [2.0.0] - 2024-10-01

- **Added**: Introduced a Stripe-first microservices architecture with custom JWT authentication and a full OpenAI chat interface.

## [1.0.0] - 2024-09-01

- **Added**: Initial release with basic, read-only fantasy sports data fetching from ESPN and a simple web interface.
