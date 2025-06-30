# Auth Worker

Platform-agnostic credential storage worker for FLAIM.

## Overview

The Auth Worker is a centralized Cloudflare Worker responsible for storing, retrieving, and managing user platform credentials (ESPN, Yahoo, Sleeper, etc.) with encrypted KV storage.

## Endpoints

- `GET /health` - Health check with KV connectivity test
- `POST /credentials/:platform` - Store platform credentials
- `GET /credentials/:platform` - Get credential metadata
- `DELETE /credentials/:platform` - Delete platform credentials

## Supported Platforms

- `espn` - ESPN Fantasy credentials (swid, s2)
- `yahoo` - Yahoo Fantasy credentials (access_token, refresh_token)
- `sleeper` - Sleeper credentials (access_token)

## Authentication

All credential endpoints require the `X-Clerk-User-ID` header containing the Clerk user ID.

## Development

```bash
# Start development server
npm run dev

# Type check
npx tsc --noEmit

# Run tests
npm test

# Deploy
npm run deploy
```

## Environment Variables

- `CF_KV_CREDENTIALS` - KV namespace binding for credential storage
- `CF_ENCRYPTION_KEY` - AES-GCM encryption key for credentials
- `NODE_ENV` - Environment (development/production)

## Phase 1.5 Compliance

This implementation follows the Phase 1.5 requirements:
- ✅ Uses `X-Clerk-User-ID` header (no Bearer token verification)
- ✅ Proper encryption initialization
- ✅ No `@clerk/backend` dependency
- ✅ Type-safe credential handling
- ✅ Unit test structure for header-based auth