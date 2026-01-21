# Flaim Testing Strategy

A streamlined, phased testing approach for a solo developer pre-launch.

---

## Current State

**What exists:**
- Jest 30 configured in `auth-worker` (needs migration to Vitest)
- 2 test files: `league-discovery.test.ts`, `get-league-teams.test.ts` (~15 tests)
- Playwright dependency installed but not configured

**What's missing:**
- No tests for OAuth handlers (security-critical)
- No tests for MCP tools (core product functionality)
- No integration tests using Workers runtime
- No E2E tests

---

## Testing Philosophy

### Guiding Principles

1. **Test what would wake you up at 3am if broken**
2. **Prioritize security-critical code** (OAuth, auth, token handling)
3. **Cover core product functionality** (MCP tools, routing)
4. **Keep tests fast and maintainable**
5. **Avoid testing third-party libraries** (Clerk, Supabase, ESPN API)

### Target Test Pyramid

```
         ┌─────────────┐
         │  E2E (5%)   │  ← Playwright: Critical happy paths only
         ├─────────────┤
         │Integration  │  ← Vitest + SELF: Worker HTTP endpoints
         │   (25%)     │
         ├─────────────┤
         │   Unit      │  ← Vitest: Pure functions, business logic
         │   (70%)     │
         └─────────────┘
```

---

## Critical Decision: Vitest, Not Jest

**Cloudflare officially recommends Vitest** with `@cloudflare/vitest-pool-workers` for testing Workers. This is non-negotiable for several reasons:

| Aspect | Jest (current) | Vitest (recommended) |
|--------|----------------|----------------------|
| Runtime | Node.js | Workers runtime via Miniflare |
| Workers APIs | ❌ Not available | ✅ Full access |
| Service bindings | ❌ Must mock | ✅ Real bindings |
| ESM support | Fragile with ts-jest | Native |
| Integration tests | Manual HTTP mocking | `SELF` fetcher built-in |

**Migration effort:** Low — Vitest syntax is nearly identical to Jest.

### Vitest Configuration (per worker)

```typescript
// vitest.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

```bash
# Install
npm i -D vitest @cloudflare/vitest-pool-workers
```

---

## Pre-Implementation: Extract Shared Code

Before writing tests, address code duplication that would require testing the same logic twice.

### Season Utils → Shared Package

**Problem:** `getCurrentSeason` logic is duplicated in `auth-worker` and `fantasy-mcp`.

**Solution:** Extract to `@flaim/worker-shared`:

```
workers/shared/src/
  season-utils.ts      # Move from auth-worker
  index.ts             # Export all
```

Then import in both workers:
```typescript
import { getDefaultSeasonYear, isCurrentSeason } from '@flaim/worker-shared';
```

**Benefit:** Test once, use everywhere. Eliminates sync drift.

---

## Phase 0: Migrate to Vitest

**Effort:** 1-2 hours | **Prerequisite for everything else**

### Steps

1. Install Vitest in `auth-worker`:
   ```bash
   cd workers/auth-worker
   npm i -D vitest @cloudflare/vitest-pool-workers
   ```

2. Create `vitest.config.ts` (see configuration above)

3. Update `package.json`:
   ```json
   { "scripts": { "test": "vitest run", "test:watch": "vitest" } }
   ```

4. Update test imports from `@jest/globals` to `vitest`:
   ```typescript
   // Before
   import { describe, expect, it } from '@jest/globals';
   // After
   import { describe, expect, it } from 'vitest';
   ```

5. Remove Jest dependencies: `npm rm jest ts-jest @jest/globals @types/jest`

6. Run existing tests to verify migration

### Repeat for `fantasy-mcp`

Same process. Both workers should use Vitest before proceeding.

---

## Phase 1: Unit Tests (Pure Functions)

**Effort:** Low | **Risk Coverage:** High | **Maintenance:** Minimal

Test deterministic functions with no external dependencies.

### 1.1 Season Utils

**File:** `workers/shared/src/season-utils.ts`
**Test:** `workers/shared/src/__tests__/season-utils.test.ts`

**Why:** Date-based logic is error-prone. Season boundaries affect which leagues users see.

**Test cases:**
- Baseball: returns previous year before Feb 1, current year after
- Football: returns previous year before Jun 1, current year after
- Basketball/Hockey: returns previous year before Oct 1, current year after
- Edge cases: year boundary (Dec 31 → Jan 1), timezone handling
- Default behavior when no date provided

**Estimated tests:** ~20

### 1.2 ESPN Types & Validation

**File:** `workers/auth-worker/src/espn-types.ts`
**Test:** `workers/auth-worker/src/__tests__/espn-types.test.ts`

**Why:** Type guards and validators protect against malformed data.

**Test cases:**
- `isValidSport`: accepts football/baseball/basketball/hockey, rejects others
- `isValidGameId`: accepts ffl/flb/fba/fhl, rejects others
- `gameIdToSport` / `sportToGameId`: bidirectional conversion
- `validateEspnCredentials`: SWID format, S2 length, missing fields
- Error classes: correct names, messages, custom properties

**Estimated tests:** ~25

### 1.3 MCP Response Formatters

**File:** `workers/fantasy-mcp/src/mcp/tools.ts`
**Test:** `workers/fantasy-mcp/src/__tests__/mcp-formatters.test.ts`

**Why:** Ensure MCP responses have correct structure for Claude/ChatGPT.

**Test cases:**
- `mcpSuccess`: wraps data in `{ content: [{ type: 'text', text }] }`
- `mcpError`: includes `isError: true` flag
- JSON serialization with proper formatting

**Estimated tests:** ~10

### Phase 1 Summary

| Test File | Coverage | Est. Tests |
|-----------|----------|------------|
| `season-utils.test.ts` | Season calculations | ~20 |
| `espn-types.test.ts` | Validation, type guards | ~25 |
| `mcp-formatters.test.ts` | Response structure | ~10 |
| **Total** | | **~55** |

---

## Phase 2: Integration Tests (HTTP Layer)

**Effort:** Medium | **Risk Coverage:** Critical | **Maintenance:** Moderate

Test worker endpoints using Vitest's `SELF` fetcher — no mocking required.

### Why SELF Instead of Mocks?

The previous strategy proposed mocking Supabase with 10+ chained methods:
```typescript
// ❌ Brittle — breaks if Supabase API changes
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  // ... 8 more methods
};
```

With Vitest's `SELF`, you test real HTTP behavior:
```typescript
// ✅ Tests actual endpoint behavior
import { SELF } from 'cloudflare:test';

it('returns 401 without auth', async () => {
  const response = await SELF.fetch('http://test/credentials/espn');
  expect(response.status).toBe(401);
});
```

### 2.1 Auth Worker Endpoints

**Test:** `workers/auth-worker/src/__tests__/endpoints.test.ts`

**Why:** OAuth and credential endpoints are security-critical.

**Test cases:**

**Health endpoint:**
- Returns 200 with `{ status: 'healthy' }` when Supabase connected
- Returns 503 with `{ status: 'degraded' }` when Supabase down

**OAuth metadata (RFC 8414):**
- Returns valid JSON with required fields: `issuer`, `authorization_endpoint`, `token_endpoint`
- Includes `response_types_supported`, `grant_types_supported`, `code_challenge_methods_supported`
- Uses correct URLs for dev vs prod environment
- Sets appropriate cache headers

**Authorization endpoint:**
- Rejects `response_type` other than `code`
- Requires `redirect_uri` parameter
- Validates `redirect_uri` against allowlist
- Requires PKCE `code_challenge` (OAuth 2.1)
- Allows Claude.ai, Claude.com, ChatGPT, loopback URIs
- Rejects unlisted redirect URIs
- Redirects to consent page with valid params

**Protected endpoints:**
- `/credentials/espn`: Returns 401 without auth
- `/leagues`: Returns 401 without auth
- All endpoints: Reject invalid JWTs

**CORS:**
- Responds to OPTIONS preflight
- Allows `flaim.app` origin
- Allows Vercel preview URLs
- Rejects unknown origins in production

**Estimated tests:** ~25

### 2.2 MCP Gateway Endpoints

**Test:** `workers/fantasy-mcp/src/__tests__/endpoints.test.ts`

**Why:** MCP routing errors break all tools.

**Test cases:**

**Health endpoint:**
- Returns 200 with service info

**Tool routing:**
- Routes ESPN requests to ESPN service binding
- Returns error for unsupported platform (e.g., Yahoo before implementation)
- Passes auth header through to platform workers
- Handles platform worker errors gracefully
- Handles network/timeout errors

**MCP protocol:**
- `tools/list` returns all tool definitions
- `tools/call` dispatches to correct handler
- Error responses follow MCP format

**Estimated tests:** ~20

### 2.3 Service Binding Tests

**Test:** `workers/fantasy-mcp/src/__tests__/bindings.test.ts`

Configure Vitest to use actual service bindings:

```typescript
// vitest.config.ts
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        miniflare: {
          serviceBindings: {
            AUTH_WORKER: 'auth-worker',
            ESPN: 'espn-client',
          },
        },
      },
    },
  },
});
```

**Test cases:**
- `AUTH_WORKER` binding responds to `/leagues` requests
- `ESPN` binding responds to tool requests
- Binding failures produce clear error messages

**Estimated tests:** ~10

### Phase 2 Summary

| Test File | Coverage | Est. Tests |
|-----------|----------|------------|
| `auth-worker/endpoints.test.ts` | OAuth, credentials, CORS | ~25 |
| `fantasy-mcp/endpoints.test.ts` | MCP routing, tools | ~20 |
| `fantasy-mcp/bindings.test.ts` | Service bindings | ~10 |
| **Total** | | **~55** |

---

## Phase 3: E2E Tests (Critical Paths Only)

**Effort:** High | **Risk Coverage:** Full stack | **Maintenance:** Higher

Playwright tests for user-facing critical paths. Keep this minimal.

### 3.1 Playwright Configuration

**File:** `playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Auth setup runs first
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'npm run dev:frontend',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

### 3.2 Authentication Setup

**File:** `e2e/auth.setup.ts`

Per Playwright best practices, authenticate once and reuse state:

```typescript
import { test as setup, expect } from '@playwright/test';

const authFile = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Use test credentials from environment
  await page.goto('/sign-in');
  // ... Clerk sign-in flow
  await page.context().storageState({ path: authFile });
});
```

**Important:** Add `e2e/.auth/` to `.gitignore`.

### 3.3 Critical Path Tests

**File:** `e2e/critical-paths.spec.ts`

**Test only what matters:**

**Landing page:**
- Loads successfully
- Has sign-in link
- Has get-started CTA

**Authentication:**
- Sign-in page loads (Clerk renders)
- Sign-up page loads
- Protected routes redirect to sign-in

**OAuth consent flow:**
- Shows error without required params
- Loads consent UI with valid params

**Static pages:**
- Privacy policy loads

**Estimated tests:** ~10

### 3.4 API Smoke Tests

**File:** `e2e/api-smoke.spec.ts`

Quick health checks for deployed workers:

```typescript
test('auth-worker is healthy', async ({ request }) => {
  const response = await request.get(`${AUTH_WORKER_URL}/health`);
  expect(response.ok()).toBe(true);
});
```

**Estimated tests:** ~5

### Phase 3 Summary

| Test File | Coverage | Est. Tests |
|-----------|----------|------------|
| `auth.setup.ts` | Authentication state | 1 |
| `critical-paths.spec.ts` | User journeys | ~10 |
| `api-smoke.spec.ts` | Worker health | ~5 |
| **Total** | | **~16** |

---

## CI/CD Integration

### GitHub Actions Workflow

**File:** `.github/workflows/test.yml`

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-and-integration:
    name: Unit & Integration Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm test -w workers/shared
      - run: npm test -w workers/auth-worker
      - run: npm test -w workers/fantasy-mcp

  e2e:
    name: E2E Tests
    runs-on: ubuntu-latest
    # Only on main to save CI minutes
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
        env:
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.CLERK_PUBLISHABLE_KEY }}
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

---

## Test Commands

Add to root `package.json`:

```json
{
  "scripts": {
    "test": "npm test --workspaces --if-present",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

Per-worker:
```bash
cd workers/auth-worker && npm test       # Unit + integration
cd workers/fantasy-mcp && npm test       # Unit + integration
npm run test:e2e                         # Playwright E2E
```

---

## Implementation Priority

Execute in this order:

| Step | Task | Effort | Blocks |
|------|------|--------|--------|
| **0** | Migrate auth-worker Jest → Vitest | 1-2 hrs | Everything |
| **1** | Extract season-utils to shared | 1 hr | Phase 1 tests |
| **2** | Phase 1: Unit tests | 2-3 hrs | — |
| **3** | Migrate fantasy-mcp to Vitest | 1 hr | Phase 2 |
| **4** | Phase 2: Integration tests | 3-4 hrs | — |
| **5** | Phase 3: Playwright setup + E2E | 2-3 hrs | — |
| **6** | CI workflow | 30 min | — |

**Total estimated effort:** 10-14 hours

---

## What NOT to Test

- **Chrome extension** — Manual testing sufficient, low change frequency
- **Next.js UI components** — High churn during development, low ROI
- **Legacy workers** — `baseball-espn-mcp`, `football-espn-mcp` being deprecated
- **Third-party libraries** — Clerk, Supabase, ESPN API
- **CSS/styling** — Visual testing not worth the complexity
- **Happy path variations** — Test one success case, focus on error cases

---

## Test Estimation Summary

| Phase | Focus | Tests |
|-------|-------|-------|
| Phase 1 | Unit (pure functions) | ~55 |
| Phase 2 | Integration (HTTP/bindings) | ~55 |
| Phase 3 | E2E (critical paths) | ~16 |
| **Total** | | **~126** |

---

## Key Principle

**Test what would wake you up at 3am:**

1. **OAuth breaks** → Users can't connect Claude/ChatGPT
2. **MCP tools break** → Product doesn't work at all
3. **Season logic breaks** → Users see wrong data
4. **Credential handling breaks** → Security/data integrity issues

Everything else can be caught manually or fixed quickly post-launch.
