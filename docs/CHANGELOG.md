# Changelog (Condensed)

Follow Keep a Changelog; SemVer applies. Planning docs live in `docs/dev`.

## [Unreleased]
- Note: OpenAI usage now references the **Responses API** (not legacy chat completions).
- Fix: Strip custom-domain prefixes for auth/baseball/football workers; avoid 404s.
- Fix: Worker-to-worker must use `.workers.dev`; prod auth-worker enables `workers_dev: true`.
- Fix: Credential check returns 200 with `hasCredentials: false` instead of 404.
- Fix: Trailing slash env URLs no longer break onboarding; timeouts resolved by direct URLs.
- Security: JWKS-based JWT verification enforced in prod; workers forward `Authorization`.
- Infra: Secrets for prod workers set via Cloudflare Dashboard (not `wrangler secret put`).
- Docs: Added onboarding explanation, DNS setup, and timeout/404 troubleshooting.

## [6.1.0] - 2025-07-08
- Updated to React 19.1.0 / Next.js 15.3.4. 
- Migrated worker configs to `wrangler.jsonc`; fixed Next.js route handler builds.

## [6.0.0]
- Added unified dev/prod scripts (now replaced by GitOps); centralized auth-worker; moved credentials to Supabase.

## [4.1.1]
- Added automatic ESPN league discovery.

## [4.1.0]
- Extracted modular `flaim/auth`; added football MCP worker; raised free tier limit to 100 messages/month.

## [4.0.0]
- Security fix: removed header spoofing by enforcing server-side Clerk verification.

## [3.0.0]
- Integrated Clerk auth; added usage tracking and secure credential management.

## [2.0.0]
- Introduced Stripe-first microservices architecture with OpenAI chat (later simplified).

## [1.0.0]
- Initial release with basic ESPN data and simple web UI.
