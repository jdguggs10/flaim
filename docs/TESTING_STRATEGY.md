# Flaim Testing Strategy

A streamlined testing approach for a solo developer in early-stage development.

## Current State

**What exists:**
- Jest 30 configured in `auth-worker` with ts-jest ESM preset
- 2 test files: `league-discovery.test.ts`, `get-league-teams.test.ts` (~15 tests total)
- Playwright dependency installed but not configured

**What's missing:**
- No tests for OAuth handlers (security-critical)
- No tests for MCP tools (core product functionality)
- No integration/E2E tests
- No test configuration in other workers or web app

## Recommended Testing Pyramid

For a solo developer pre-launch, prioritize **high-value, low-maintenance** tests:

```
         ┌─────────────┐
         │  E2E (Few)  │  ← Playwright: Critical happy paths only
         ├─────────────┤
         │ Integration │  ← API route tests, worker endpoints
         ├─────────────┤
         │    Unit     │  ← Pure functions, business logic
         └─────────────┘
```

**Target ratio:** 70% unit, 25% integration, 5% E2E

## Priority 1: High-Risk Unit Tests (Do First)

These areas have the highest risk if broken and are easiest to test.

### 1.1 OAuth Handlers (`auth-worker/src/oauth-handlers.ts`)

OAuth is security-critical. Test:
- Token validation logic
- PKCE verification
- Token expiration handling
- Error responses (401, 403 codes)

```typescript
// Example: workers/auth-worker/src/__tests__/oauth-handlers.test.ts
describe('validateAuthorizationCode', () => {
  it('rejects expired codes', async () => { ... });
  it('rejects invalid PKCE verifier', async () => { ... });
  it('returns tokens for valid code', async () => { ... });
});
```

### 1.2 Season Utils (`auth-worker/src/season-utils.ts`)

Date-based logic is easy to get wrong. Test all edge cases:
- Baseball season boundary (Feb 1)
- Football season boundary (Jun 1)
- Year transitions (Dec 31 → Jan 1)

### 1.3 ESPN Error Handling (`auth-worker/src/espn-types.ts`)

Already partially tested. Complete coverage for:
- `EspnCredentialsRequired`
- `EspnAuthenticationFailed`
- `EspnApiError`
- `AutomaticLeagueDiscoveryFailed`

## Priority 2: MCP Tool Tests (Do Second)

Your product's core value. Test the unified gateway tools.

### 2.1 Tool Parameter Validation (`fantasy-mcp/src/mcp/tools.ts`)

```typescript
// workers/fantasy-mcp/src/__tests__/tools.test.ts
describe('MCP Tools', () => {
  describe('get_league_info', () => {
    it('validates required parameters', async () => { ... });
    it('handles missing credentials gracefully', async () => { ... });
    it('returns structured league data', async () => { ... });
  });
});
```

### 2.2 Mock ESPN Responses

Create realistic fixtures for ESPN API responses:

```
workers/
  __fixtures__/
    espn-league-info-football.json
    espn-league-info-baseball.json
    espn-standings.json
    espn-matchups.json
```

## Priority 3: Integration Tests (Do Before Launch)

Test real endpoint behavior without external dependencies.

### 3.1 Auth Worker Endpoints

```typescript
// workers/auth-worker/src/__tests__/integration/endpoints.test.ts
describe('Auth Worker Endpoints', () => {
  describe('GET /health', () => {
    it('returns 200', async () => { ... });
  });

  describe('POST /extension/sync', () => {
    it('requires valid Clerk JWT', async () => { ... });
    it('stores credentials on success', async () => { ... });
  });
});
```

### 3.2 MCP HTTP Transport

```typescript
// workers/fantasy-mcp/src/__tests__/integration/mcp-transport.test.ts
describe('MCP HTTP Transport', () => {
  it('handles tools/list request', async () => { ... });
  it('handles tools/call request', async () => { ... });
  it('returns 401 without auth', async () => { ... });
});
```

## Priority 4: E2E Tests (Post-Launch)

Use Playwright sparingly for critical user journeys.

### 4.1 Recommended E2E Scenarios

Only test what would be catastrophic if broken:

1. **Landing page loads** - Basic smoke test
2. **OAuth consent flow** - User can complete authorization
3. **Extension sync** - Credentials reach auth-worker

### 4.2 Playwright Setup

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
  },
});
```

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Add Jest to `fantasy-mcp` worker (copy auth-worker config)
- [ ] Write season-utils tests (deterministic, easy wins)
- [ ] Write OAuth token validation tests

### Phase 2: Core Product (Week 2)
- [ ] Add MCP tool parameter validation tests
- [ ] Create ESPN response fixtures
- [ ] Write happy-path tool tests with mocked ESPN

### Phase 3: Integration (Pre-Launch)
- [ ] Add endpoint integration tests for auth-worker
- [ ] Add MCP transport tests for fantasy-mcp
- [ ] Configure CI to run tests on PR

### Phase 4: E2E (Post-Launch)
- [ ] Configure Playwright
- [ ] Add 3-5 critical path E2E tests
- [ ] Add to CI pipeline

## Test Commands

Add to root `package.json`:

```json
{
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "test:auth": "cd workers/auth-worker && npm test",
    "test:mcp": "cd workers/fantasy-mcp && npm test",
    "test:e2e": "playwright test"
  }
}
```

## What NOT to Test (For Now)

Skip these to maintain velocity:

- **Chrome extension** - Manual testing sufficient; browser APIs hard to mock
- **Next.js page components** - UI changes frequently; low ROI for unit tests
- **Deprecated legacy workers** - `baseball-espn-mcp`, `football-espn-mcp` being replaced
- **Third-party integrations** - Don't test Clerk, Supabase, or ESPN themselves

## CI/CD Integration

Add to `.github/workflows/test.yml`:

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm test
```

## Measuring Success

**Minimum viable coverage targets:**
- `auth-worker`: 60% (focus on oauth-handlers, espn-types)
- `fantasy-mcp`: 50% (focus on tools.ts, parameter validation)
- Overall: Don't obsess over percentages; prioritize critical paths

**Quality over quantity:**
- Fast tests (< 10s total run time)
- No flaky tests
- Tests document expected behavior

## Quick Reference: Jest Config Template

For adding tests to a new worker:

```javascript
// workers/<worker-name>/jest.config.js
export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
};
```

Add to worker's `package.json`:
```json
{
  "scripts": {
    "test": "NODE_OPTIONS='--experimental-vm-modules' jest",
    "test:watch": "NODE_OPTIONS='--experimental-vm-modules' jest --watch"
  },
  "devDependencies": {
    "@jest/globals": "^30.0.0",
    "jest": "^30.0.0",
    "ts-jest": "^29.2.0"
  }
}
```

## Summary

| Priority | Area | Tests | Effort | ROI |
|----------|------|-------|--------|-----|
| 1 | OAuth handlers | Unit | Low | **High** |
| 1 | Season utils | Unit | Low | **High** |
| 2 | MCP tools | Unit | Medium | **High** |
| 3 | Worker endpoints | Integration | Medium | Medium |
| 4 | Critical paths | E2E | High | Medium |

**Key principle:** Test what would wake you up at 3am if broken. For Flaim, that's:
1. OAuth (users can't connect)
2. MCP tools (product doesn't work)
3. Credential storage (data integrity)

Everything else can be caught manually or fixed quickly post-launch.
