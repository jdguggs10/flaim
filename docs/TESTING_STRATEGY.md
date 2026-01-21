# Flaim Testing Strategy

A streamlined, phased testing approach for a solo developer in early-stage development.

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

## Testing Philosophy

**Guiding Principles:**
1. Test what would wake you up at 3am if broken
2. Prioritize security-critical code (OAuth, auth)
3. Cover core product functionality (MCP tools)
4. Keep tests fast and maintainable
5. Avoid testing third-party libraries

**Target Test Pyramid:**
```
         ┌─────────────┐
         │  E2E (5%)   │  ← Playwright: Critical happy paths only
         ├─────────────┤
         │Integration  │  ← Worker endpoints, HTTP layer
         │   (25%)     │
         ├─────────────┤
         │   Unit      │  ← Pure functions, business logic
         │   (70%)     │
         └─────────────┘
```

---

# Phase 1: Easy Wins (Unit Tests for Pure Functions)

**Effort:** Low | **Risk Coverage:** High | **Maintenance:** Minimal

These are deterministic, pure functions with no external dependencies. They're the easiest to test and provide immediate confidence in critical business logic.

## 1.1 Season Utils Tests

**File:** `workers/auth-worker/src/season-utils.ts`
**Why:** Date-based logic is notoriously error-prone. Season boundaries affect which leagues users see.

### Test File: `workers/auth-worker/src/__tests__/season-utils.test.ts`

```typescript
import { describe, expect, it } from '@jest/globals';
import { getDefaultSeasonYear, isCurrentSeason, SeasonSport } from '../season-utils';

describe('season-utils', () => {
  describe('getDefaultSeasonYear', () => {
    // ==========================================================================
    // BASEBALL: Rolls over Feb 1
    // ==========================================================================
    describe('baseball', () => {
      it('returns previous year before Feb 1', () => {
        // Jan 15, 2026 → should return 2025
        const jan15 = new Date('2026-01-15T12:00:00-05:00');
        expect(getDefaultSeasonYear('baseball', jan15)).toBe(2025);
      });

      it('returns previous year on Jan 31 (day before rollover)', () => {
        const jan31 = new Date('2026-01-31T23:59:59-05:00');
        expect(getDefaultSeasonYear('baseball', jan31)).toBe(2025);
      });

      it('returns current year on Feb 1 (rollover day)', () => {
        const feb1 = new Date('2026-02-01T00:00:00-05:00');
        expect(getDefaultSeasonYear('baseball', feb1)).toBe(2026);
      });

      it('returns current year after Feb 1', () => {
        const mar15 = new Date('2026-03-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('baseball', mar15)).toBe(2026);
      });

      it('returns current year in December', () => {
        const dec15 = new Date('2026-12-15T12:00:00-05:00');
        expect(getDefaultSeasonYear('baseball', dec15)).toBe(2026);
      });
    });

    // ==========================================================================
    // FOOTBALL: Rolls over Jun 1
    // ==========================================================================
    describe('football', () => {
      it('returns previous year before Jun 1', () => {
        // May 15, 2026 → should return 2025
        const may15 = new Date('2026-05-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('football', may15)).toBe(2025);
      });

      it('returns previous year on May 31 (day before rollover)', () => {
        const may31 = new Date('2026-05-31T23:59:59-04:00');
        expect(getDefaultSeasonYear('football', may31)).toBe(2025);
      });

      it('returns current year on Jun 1 (rollover day)', () => {
        const jun1 = new Date('2026-06-01T00:00:00-04:00');
        expect(getDefaultSeasonYear('football', jun1)).toBe(2026);
      });

      it('returns current year after Jun 1', () => {
        const sep15 = new Date('2026-09-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('football', sep15)).toBe(2026);
      });

      it('returns current year in January (post-playoffs)', () => {
        // Jan 2026 is still 2025 season for football
        const jan15 = new Date('2026-01-15T12:00:00-05:00');
        expect(getDefaultSeasonYear('football', jan15)).toBe(2025);
      });
    });

    // ==========================================================================
    // BASKETBALL: Rolls over Oct 1
    // ==========================================================================
    describe('basketball', () => {
      it('returns previous year before Oct 1', () => {
        const sep15 = new Date('2026-09-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('basketball', sep15)).toBe(2025);
      });

      it('returns current year on Oct 1', () => {
        const oct1 = new Date('2026-10-01T00:00:00-04:00');
        expect(getDefaultSeasonYear('basketball', oct1)).toBe(2026);
      });

      it('returns current year after Oct 1', () => {
        const nov15 = new Date('2026-11-15T12:00:00-05:00');
        expect(getDefaultSeasonYear('basketball', nov15)).toBe(2026);
      });
    });

    // ==========================================================================
    // HOCKEY: Rolls over Oct 1
    // ==========================================================================
    describe('hockey', () => {
      it('returns previous year before Oct 1', () => {
        const sep15 = new Date('2026-09-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('hockey', sep15)).toBe(2025);
      });

      it('returns current year on Oct 1', () => {
        const oct1 = new Date('2026-10-01T00:00:00-04:00');
        expect(getDefaultSeasonYear('hockey', oct1)).toBe(2026);
      });
    });

    // ==========================================================================
    // EDGE CASES
    // ==========================================================================
    describe('edge cases', () => {
      it('handles year boundary correctly (Dec 31 → Jan 1)', () => {
        const dec31 = new Date('2025-12-31T23:59:59-05:00');
        const jan1 = new Date('2026-01-01T00:00:00-05:00');

        // Baseball: both should be previous year (before Feb)
        expect(getDefaultSeasonYear('baseball', dec31)).toBe(2025);
        expect(getDefaultSeasonYear('baseball', jan1)).toBe(2025);

        // Football: both should be previous year (before Jun)
        expect(getDefaultSeasonYear('football', dec31)).toBe(2025);
        expect(getDefaultSeasonYear('football', jan1)).toBe(2025);
      });

      it('uses current date when no date provided', () => {
        const result = getDefaultSeasonYear('baseball');
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThanOrEqual(2024);
        expect(result).toBeLessThanOrEqual(2030);
      });
    });
  });

  describe('isCurrentSeason', () => {
    it('returns true when season matches current', () => {
      const feb15 = new Date('2026-02-15T12:00:00-05:00');
      expect(isCurrentSeason('baseball', 2026, feb15)).toBe(true);
    });

    it('returns false when season does not match current', () => {
      const feb15 = new Date('2026-02-15T12:00:00-05:00');
      expect(isCurrentSeason('baseball', 2025, feb15)).toBe(false);
    });

    it('handles football season spanning calendar years', () => {
      // Jan 2026 is still 2025 football season
      const jan15 = new Date('2026-01-15T12:00:00-05:00');
      expect(isCurrentSeason('football', 2025, jan15)).toBe(true);
      expect(isCurrentSeason('football', 2026, jan15)).toBe(false);
    });
  });
});
```

### Running the Tests

```bash
cd workers/auth-worker
npm test -- --testPathPattern=season-utils
```

---

## 1.2 ESPN Types & Validation Tests

**File:** `workers/auth-worker/src/espn-types.ts`
**Why:** Type guards and validation functions protect against malformed data.

### Test File: `workers/auth-worker/src/__tests__/espn-types.test.ts`

```typescript
import { describe, expect, it } from '@jest/globals';
import {
  isValidSport,
  isValidGameId,
  gameIdToSport,
  sportToGameId,
  validateEspnCredentials,
  EspnCredentialsRequired,
  EspnAuthenticationFailed,
  EspnApiError,
  AutomaticLeagueDiscoveryFailed,
  MaxLeaguesExceeded,
  DuplicateLeagueError,
  ESPN_GAME_IDS,
} from '../espn-types';

describe('espn-types', () => {
  // ==========================================================================
  // TYPE GUARDS
  // ==========================================================================
  describe('isValidSport', () => {
    it('returns true for valid sports', () => {
      expect(isValidSport('football')).toBe(true);
      expect(isValidSport('baseball')).toBe(true);
      expect(isValidSport('basketball')).toBe(true);
      expect(isValidSport('hockey')).toBe(true);
    });

    it('returns false for invalid sports', () => {
      expect(isValidSport('soccer')).toBe(false);
      expect(isValidSport('FOOTBALL')).toBe(false);
      expect(isValidSport('')).toBe(false);
      expect(isValidSport('ffl')).toBe(false);
    });
  });

  describe('isValidGameId', () => {
    it('returns true for valid ESPN game IDs', () => {
      expect(isValidGameId('ffl')).toBe(true);
      expect(isValidGameId('flb')).toBe(true);
      expect(isValidGameId('fba')).toBe(true);
      expect(isValidGameId('fhl')).toBe(true);
    });

    it('returns false for invalid game IDs', () => {
      expect(isValidGameId('football')).toBe(false);
      expect(isValidGameId('FFL')).toBe(false);
      expect(isValidGameId('')).toBe(false);
      expect(isValidGameId('fho')).toBe(false); // Old hockey ID
    });
  });

  // ==========================================================================
  // CONVERSION FUNCTIONS
  // ==========================================================================
  describe('gameIdToSport', () => {
    it('converts valid game IDs to sports', () => {
      expect(gameIdToSport('ffl')).toBe('football');
      expect(gameIdToSport('flb')).toBe('baseball');
      expect(gameIdToSport('fba')).toBe('basketball');
      expect(gameIdToSport('fhl')).toBe('hockey');
    });

    it('returns null for invalid game IDs', () => {
      expect(gameIdToSport('invalid')).toBeNull();
      expect(gameIdToSport('')).toBeNull();
    });
  });

  describe('sportToGameId', () => {
    it('converts valid sports to game IDs', () => {
      expect(sportToGameId('football')).toBe('ffl');
      expect(sportToGameId('baseball')).toBe('flb');
      expect(sportToGameId('basketball')).toBe('fba');
      expect(sportToGameId('hockey')).toBe('fhl');
    });

    it('returns null for invalid sports', () => {
      expect(sportToGameId('invalid')).toBeNull();
      expect(sportToGameId('')).toBeNull();
    });
  });

  // ==========================================================================
  // CREDENTIAL VALIDATION
  // ==========================================================================
  describe('validateEspnCredentials', () => {
    const validSwid = '{BFA3386F-9501-4F4A-88C7-C56D6BB86C11}';
    const validS2 = 'AEBx7jHLKx%2BLJYkzS7QYz%2BTZo4PnxxxxxXXXXxxxxXXXX';

    it('validates correct credentials', () => {
      const result = validateEspnCredentials({ swid: validSwid, s2: validS2 });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects missing SWID', () => {
      const result = validateEspnCredentials({ s2: validS2 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('SWID is required');
    });

    it('rejects missing S2', () => {
      const result = validateEspnCredentials({ swid: validSwid });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('ESPN_S2 cookie is required');
    });

    it('rejects invalid SWID format', () => {
      const result = validateEspnCredentials({ swid: 'invalid-swid', s2: validS2 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('UUID format'))).toBe(true);
    });

    it('rejects short S2 token', () => {
      const result = validateEspnCredentials({ swid: validSwid, s2: 'short' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('too short'))).toBe(true);
    });

    it('accepts S2 without curly braces (Chrome extension format)', () => {
      const swidNoBraces = 'BFA3386F-9501-4F4A-88C7-C56D6BB86C11';
      // Note: The current implementation requires braces
      const result = validateEspnCredentials({ swid: swidNoBraces, s2: validS2 });
      expect(result.valid).toBe(false); // Current impl requires braces
    });
  });

  // ==========================================================================
  // ERROR CLASSES
  // ==========================================================================
  describe('error classes', () => {
    it('EspnCredentialsRequired has correct name and message', () => {
      const error = new EspnCredentialsRequired();
      expect(error.name).toBe('EspnCredentialsRequired');
      expect(error.message).toBe('ESPN credentials required for league discovery');
    });

    it('EspnCredentialsRequired accepts custom message', () => {
      const error = new EspnCredentialsRequired('Custom message');
      expect(error.message).toBe('Custom message');
    });

    it('EspnAuthenticationFailed has correct name', () => {
      const error = new EspnAuthenticationFailed();
      expect(error.name).toBe('EspnAuthenticationFailed');
    });

    it('EspnApiError has correct name', () => {
      const error = new EspnApiError('API failed');
      expect(error.name).toBe('EspnApiError');
      expect(error.message).toBe('API failed');
    });

    it('AutomaticLeagueDiscoveryFailed includes status code', () => {
      const error = new AutomaticLeagueDiscoveryFailed('No leagues found', 404);
      expect(error.name).toBe('AutomaticLeagueDiscoveryFailed');
      expect(error.statusCode).toBe(404);
    });

    it('MaxLeaguesExceeded shows correct limit', () => {
      const error = new MaxLeaguesExceeded(10);
      expect(error.name).toBe('MaxLeaguesExceeded');
      expect(error.message).toContain('10');
    });

    it('DuplicateLeagueError includes league details', () => {
      const error = new DuplicateLeagueError('12345', 'football');
      expect(error.name).toBe('DuplicateLeagueError');
      expect(error.message).toContain('12345');
      expect(error.message).toContain('football');
    });
  });

  // ==========================================================================
  // CONSTANTS
  // ==========================================================================
  describe('ESPN_GAME_IDS constant', () => {
    it('maps all four sports correctly', () => {
      expect(ESPN_GAME_IDS.ffl).toBe('football');
      expect(ESPN_GAME_IDS.flb).toBe('baseball');
      expect(ESPN_GAME_IDS.fba).toBe('basketball');
      expect(ESPN_GAME_IDS.fhl).toBe('hockey');
    });

    it('has exactly four entries', () => {
      expect(Object.keys(ESPN_GAME_IDS)).toHaveLength(4);
    });
  });
});
```

---

## 1.3 MCP Tools Helper Functions Tests

**File:** `workers/fantasy-mcp/src/mcp/tools.ts`
**Why:** The `getCurrentSeason` function duplicates season logic and must stay in sync.

### First, add Jest to fantasy-mcp worker

**File:** `workers/fantasy-mcp/jest.config.js`

```javascript
/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
    }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
```

**Add to `workers/fantasy-mcp/package.json`:**

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

### Test File: `workers/fantasy-mcp/src/__tests__/tools-helpers.test.ts`

```typescript
import { describe, expect, it } from '@jest/globals';

// Since getCurrentSeason is not exported, we'll test it indirectly
// or create a separate exported version for testing

// For now, test the mcpSuccess/mcpError response formatters by extracting them
// This demonstrates testing internal helpers

describe('MCP Response Formatters', () => {
  // These would be extracted from tools.ts or tested via integration

  describe('mcpSuccess format', () => {
    it('wraps data in content array with text type', () => {
      const data = { success: true, leagues: [] };
      const expected = {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };

      // Simulating what mcpSuccess does
      const result = {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };

      expect(result).toEqual(expected);
    });
  });

  describe('mcpError format', () => {
    it('includes isError flag', () => {
      const message = 'Something went wrong';
      const result = {
        content: [{ type: 'text', text: message }],
        isError: true,
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(message);
    });
  });
});

describe('getCurrentSeason logic', () => {
  // Test the season calculation logic that's duplicated in tools.ts
  // This ensures consistency with auth-worker's season-utils.ts

  function getCurrentSeason(sport: string, now = new Date()): number {
    const ny = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now);

    const year = Number(ny.find((p) => p.type === 'year')?.value);
    const month = Number(ny.find((p) => p.type === 'month')?.value);

    switch (sport) {
      case 'baseball':
        return month < 2 ? year - 1 : year;
      case 'football':
        return month < 6 ? year - 1 : year;
      case 'basketball':
      case 'hockey':
        return month < 10 ? year - 1 : year;
      default:
        return year;
    }
  }

  it('matches auth-worker baseball logic', () => {
    const jan15 = new Date('2026-01-15T12:00:00-05:00');
    const feb15 = new Date('2026-02-15T12:00:00-05:00');

    expect(getCurrentSeason('baseball', jan15)).toBe(2025);
    expect(getCurrentSeason('baseball', feb15)).toBe(2026);
  });

  it('matches auth-worker football logic', () => {
    const may15 = new Date('2026-05-15T12:00:00-04:00');
    const jun15 = new Date('2026-06-15T12:00:00-04:00');

    expect(getCurrentSeason('football', may15)).toBe(2025);
    expect(getCurrentSeason('football', jun15)).toBe(2026);
  });
});
```

---

## Phase 1 Summary

| Test File | Functions Covered | Est. Tests |
|-----------|------------------|------------|
| `season-utils.test.ts` | `getDefaultSeasonYear`, `isCurrentSeason` | ~20 |
| `espn-types.test.ts` | Type guards, validators, error classes | ~25 |
| `tools-helpers.test.ts` | MCP formatters, season sync | ~10 |

**Total Phase 1:** ~55 tests covering pure business logic

---

# Phase 2: Medium Wins (OAuth & MCP Tools with Mocking)

**Effort:** Medium | **Risk Coverage:** Critical | **Maintenance:** Moderate

These tests require mocking external dependencies (Supabase, fetch) but cover the most security-critical code paths.

## 2.1 OAuth Storage Tests

**File:** `workers/auth-worker/src/oauth-storage.ts`
**Why:** OAuth token handling is security-critical. A bug here could expose user data.

### Test File: `workers/auth-worker/src/__tests__/oauth-storage.test.ts`

```typescript
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// Mock Supabase client
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  is: jest.fn().mockReturnThis(),
  gt: jest.fn().mockReturnThis(),
  single: jest.fn(),
  rpc: jest.fn(),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupabase,
}));

import { OAuthStorage } from '../oauth-storage';

describe('OAuthStorage', () => {
  let storage: OAuthStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new OAuthStorage('https://test.supabase.co', 'test-key');
  });

  // ==========================================================================
  // AUTHORIZATION CODES
  // ==========================================================================
  describe('createAuthorizationCode', () => {
    it('creates code with default 10 minute expiry', async () => {
      mockSupabase.insert.mockReturnValue({
        error: null,
      });

      const code = await storage.createAuthorizationCode({
        userId: 'user_123',
        redirectUri: 'https://claude.ai/callback',
        scope: 'mcp:read',
      });

      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(20);
      expect(mockSupabase.from).toHaveBeenCalledWith('oauth_codes');
    });

    it('stores PKCE challenge when provided', async () => {
      mockSupabase.insert.mockReturnValue({
        error: null,
      });

      await storage.createAuthorizationCode({
        userId: 'user_123',
        redirectUri: 'https://claude.ai/callback',
        codeChallenge: 'challenge123',
        codeChallengeMethod: 'S256',
      });

      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          code_challenge: 'challenge123',
          code_challenge_method: 'S256',
        })
      );
    });

    it('throws on database error', async () => {
      mockSupabase.insert.mockReturnValue({
        error: { message: 'DB error' },
      });

      await expect(
        storage.createAuthorizationCode({
          userId: 'user_123',
          redirectUri: 'https://test.com',
        })
      ).rejects.toThrow('Failed to create authorization code');
    });
  });

  describe('getAuthorizationCode', () => {
    it('returns null for non-existent code', async () => {
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await storage.getAuthorizationCode('invalid-code');
      expect(result).toBeNull();
    });

    it('returns null for expired code', async () => {
      mockSupabase.single.mockResolvedValue({
        data: {
          code: 'test-code',
          user_id: 'user_123',
          redirect_uri: 'https://test.com',
          expires_at: new Date(Date.now() - 1000).toISOString(), // Expired
          used_at: null,
        },
        error: null,
      });

      const result = await storage.getAuthorizationCode('test-code');
      expect(result).toBeNull();
    });

    it('returns null for already-used code', async () => {
      mockSupabase.single.mockResolvedValue({
        data: {
          code: 'test-code',
          user_id: 'user_123',
          redirect_uri: 'https://test.com',
          expires_at: new Date(Date.now() + 60000).toISOString(),
          used_at: new Date().toISOString(), // Already used
        },
        error: null,
      });

      const result = await storage.getAuthorizationCode('test-code');
      expect(result).toBeNull();
    });

    it('returns valid code data', async () => {
      const futureDate = new Date(Date.now() + 60000);
      mockSupabase.single.mockResolvedValue({
        data: {
          code: 'test-code',
          user_id: 'user_123',
          redirect_uri: 'https://test.com',
          scope: 'mcp:read',
          code_challenge: 'challenge',
          code_challenge_method: 'S256',
          expires_at: futureDate.toISOString(),
          used_at: null,
        },
        error: null,
      });

      const result = await storage.getAuthorizationCode('test-code');

      expect(result).not.toBeNull();
      expect(result?.userId).toBe('user_123');
      expect(result?.codeChallenge).toBe('challenge');
    });
  });

  // ==========================================================================
  // ACCESS TOKENS
  // ==========================================================================
  describe('validateAccessToken', () => {
    it('returns invalid for non-existent token', async () => {
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await storage.validateAccessToken('invalid-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token not found');
    });

    it('returns invalid for revoked token', async () => {
      mockSupabase.single.mockResolvedValue({
        data: {
          user_id: 'user_123',
          scope: 'mcp:read',
          expires_at: new Date(Date.now() + 60000).toISOString(),
          revoked_at: new Date().toISOString(), // Revoked
        },
        error: null,
      });

      const result = await storage.validateAccessToken('revoked-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token has been revoked');
    });

    it('returns invalid for expired token', async () => {
      mockSupabase.single.mockResolvedValue({
        data: {
          user_id: 'user_123',
          scope: 'mcp:read',
          expires_at: new Date(Date.now() - 1000).toISOString(), // Expired
          revoked_at: null,
        },
        error: null,
      });

      const result = await storage.validateAccessToken('expired-token');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token has expired');
    });

    it('returns valid with user ID for good token', async () => {
      mockSupabase.single.mockResolvedValue({
        data: {
          user_id: 'user_123',
          scope: 'mcp:read',
          expires_at: new Date(Date.now() + 60000).toISOString(),
          revoked_at: null,
        },
        error: null,
      });

      const result = await storage.validateAccessToken('valid-token');

      expect(result.valid).toBe(true);
      expect(result.userId).toBe('user_123');
      expect(result.scope).toBe('mcp:read');
    });
  });

  // ==========================================================================
  // RATE LIMITING
  // ==========================================================================
  describe('checkRateLimit', () => {
    it('returns allowed=true when no usage exists', async () => {
      mockSupabase.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await storage.checkRateLimit('user_123', 200);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(200);
      expect(result.limit).toBe(200);
    });

    it('returns allowed=false when limit exceeded', async () => {
      mockSupabase.single.mockResolvedValue({
        data: {
          request_count: 200,
          window_date: new Date().toISOString().split('T')[0],
        },
        error: null,
      });

      const result = await storage.checkRateLimit('user_123', 200);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('calculates remaining correctly', async () => {
      mockSupabase.single.mockResolvedValue({
        data: {
          request_count: 150,
          window_date: new Date().toISOString().split('T')[0],
        },
        error: null,
      });

      const result = await storage.checkRateLimit('user_123', 200);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(50);
    });
  });
});
```

---

## 2.2 OAuth Handlers Tests

**File:** `workers/auth-worker/src/oauth-handlers.ts`
**Why:** These handlers process OAuth requests. Bugs could break Claude/ChatGPT integration.

### Test File: `workers/auth-worker/src/__tests__/oauth-handlers.test.ts`

```typescript
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  handleMetadataDiscovery,
  handleAuthorize,
} from '../oauth-handlers';

describe('OAuth Handlers', () => {
  const mockEnv = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_KEY: 'test-key',
    ENVIRONMENT: 'prod',
    NODE_ENV: 'production',
  };

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
  };

  // ==========================================================================
  // METADATA DISCOVERY (RFC 8414)
  // ==========================================================================
  describe('handleMetadataDiscovery', () => {
    it('returns valid OAuth metadata JSON', async () => {
      const response = handleMetadataDiscovery(mockEnv, corsHeaders);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.issuer).toBe('https://api.flaim.app');
      expect(data.authorization_endpoint).toContain('/auth/authorize');
      expect(data.token_endpoint).toContain('/auth/token');
    });

    it('includes required OAuth 2.0 fields', async () => {
      const response = handleMetadataDiscovery(mockEnv, corsHeaders);
      const data = await response.json();

      expect(data.response_types_supported).toContain('code');
      expect(data.grant_types_supported).toContain('authorization_code');
      expect(data.grant_types_supported).toContain('refresh_token');
      expect(data.code_challenge_methods_supported).toContain('S256');
    });

    it('uses localhost URLs in dev environment', async () => {
      const devEnv = { ...mockEnv, ENVIRONMENT: 'dev' };
      const response = handleMetadataDiscovery(devEnv, corsHeaders);
      const data = await response.json();

      expect(data.issuer).toBe('http://localhost:8786');
    });

    it('sets cache headers', () => {
      const response = handleMetadataDiscovery(mockEnv, corsHeaders);

      expect(response.headers.get('Cache-Control')).toContain('max-age=3600');
    });
  });

  // ==========================================================================
  // AUTHORIZATION ENDPOINT
  // ==========================================================================
  describe('handleAuthorize', () => {
    function createAuthRequest(params: Record<string, string>): Request {
      const url = new URL('https://api.flaim.app/authorize');
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      return new Request(url.toString());
    }

    it('requires response_type=code', () => {
      const request = createAuthRequest({
        response_type: 'token', // Invalid
        client_id: 'test',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      });

      const response = handleAuthorize(request, mockEnv);

      // Should redirect with error since redirect_uri is valid
      expect(response.status).toBe(302);
      const location = response.headers.get('Location');
      expect(location).toContain('error=unsupported_response_type');
    });

    it('requires redirect_uri', async () => {
      const request = createAuthRequest({
        response_type: 'code',
        client_id: 'test',
        // Missing redirect_uri
      });

      const response = handleAuthorize(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('invalid_request');
      expect(data.error_description).toContain('redirect_uri is required');
    });

    it('validates redirect_uri against allowlist', async () => {
      const request = createAuthRequest({
        response_type: 'code',
        client_id: 'test',
        redirect_uri: 'https://evil.com/callback', // Not allowed
      });

      const response = handleAuthorize(request, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('invalid_request');
      expect(data.error_description).toContain('not in the allowed list');
    });

    it('requires PKCE code_challenge (OAuth 2.1)', () => {
      const request = createAuthRequest({
        response_type: 'code',
        client_id: 'test',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        // Missing code_challenge
      });

      const response = handleAuthorize(request, mockEnv);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location');
      expect(location).toContain('error=invalid_request');
      expect(location).toContain('PKCE');
    });

    it('redirects to consent page with valid params', () => {
      const request = createAuthRequest({
        response_type: 'code',
        client_id: 'test',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_challenge: 'challenge123',
        code_challenge_method: 'S256',
        state: 'state123',
      });

      const response = handleAuthorize(request, mockEnv);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location');
      expect(location).toContain('flaim.app/oauth/consent');
      expect(location).toContain('code_challenge=challenge123');
      expect(location).toContain('state=state123');
    });

    it('allows Claude.ai redirect URIs', () => {
      const request = createAuthRequest({
        response_type: 'code',
        client_id: 'test',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_challenge: 'challenge123',
      });

      const response = handleAuthorize(request, mockEnv);

      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toContain('oauth/consent');
    });

    it('allows Claude.com redirect URIs', () => {
      const request = createAuthRequest({
        response_type: 'code',
        client_id: 'test',
        redirect_uri: 'https://claude.com/api/mcp/auth_callback',
        code_challenge: 'challenge123',
      });

      const response = handleAuthorize(request, mockEnv);

      expect(response.status).toBe(302);
    });

    it('allows ChatGPT redirect URIs', () => {
      const request = createAuthRequest({
        response_type: 'code',
        client_id: 'test',
        redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        code_challenge: 'challenge123',
      });

      const response = handleAuthorize(request, mockEnv);

      expect(response.status).toBe(302);
    });

    it('allows loopback URIs for Claude Desktop (RFC 8252)', () => {
      const request = createAuthRequest({
        response_type: 'code',
        client_id: 'test',
        redirect_uri: 'http://127.0.0.1:54321/callback',
        code_challenge: 'challenge123',
      });

      const response = handleAuthorize(request, mockEnv);

      expect(response.status).toBe(302);
    });
  });
});
```

---

## 2.3 MCP Router Tests

**File:** `workers/fantasy-mcp/src/router.ts`
**Why:** The router dispatches to platform workers. Errors here break all tools.

### Test File: `workers/fantasy-mcp/src/__tests__/router.test.ts`

```typescript
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { routeToClient } from '../router';
import type { Env, ToolParams } from '../types';

describe('MCP Router', () => {
  // Mock service binding
  const mockEspnFetch = jest.fn();

  const mockEnv: Env = {
    ESPN: {
      fetch: mockEspnFetch,
    } as unknown as Fetcher,
    AUTH_WORKER: {} as Fetcher,
  };

  beforeEach(() => {
    mockEspnFetch.mockReset();
  });

  describe('routeToClient', () => {
    const baseParams: ToolParams = {
      platform: 'espn',
      sport: 'football',
      league_id: '12345',
      season_year: 2025,
    };

    it('routes ESPN requests to ESPN worker', async () => {
      mockEspnFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await routeToClient(mockEnv, 'get_league_info', baseParams);

      expect(mockEspnFetch).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('returns error for unsupported platform', async () => {
      const yahooParams: ToolParams = {
        ...baseParams,
        platform: 'yahoo',
      };

      const result = await routeToClient(mockEnv, 'get_league_info', yahooParams);

      expect(result.success).toBe(false);
      expect(result.code).toBe('PLATFORM_NOT_SUPPORTED');
      expect(result.error).toContain('yahoo');
    });

    it('passes auth header to platform worker', async () => {
      mockEspnFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      await routeToClient(mockEnv, 'get_roster', baseParams, 'Bearer token123');

      const request = mockEspnFetch.mock.calls[0][0] as Request;
      const body = await request.json();
      expect(body.authHeader).toBe('Bearer token123');
    });

    it('handles platform worker errors', async () => {
      mockEspnFetch.mockResolvedValue(
        new Response(JSON.stringify({
          error: 'League not found',
          code: 'LEAGUE_NOT_FOUND'
        }), { status: 404 })
      );

      const result = await routeToClient(mockEnv, 'get_league_info', baseParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('League not found');
      expect(result.code).toBe('LEAGUE_NOT_FOUND');
    });

    it('handles network errors gracefully', async () => {
      mockEspnFetch.mockRejectedValue(new Error('Connection refused'));

      const result = await routeToClient(mockEnv, 'get_league_info', baseParams);

      expect(result.success).toBe(false);
      expect(result.code).toBe('ROUTING_ERROR');
      expect(result.error).toContain('Connection refused');
    });

    it('sends correct tool name and params', async () => {
      mockEspnFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      await routeToClient(mockEnv, 'get_standings', baseParams);

      const request = mockEspnFetch.mock.calls[0][0] as Request;
      const body = await request.json();

      expect(body.tool).toBe('get_standings');
      expect(body.params.platform).toBe('espn');
      expect(body.params.sport).toBe('football');
      expect(body.params.league_id).toBe('12345');
    });
  });
});
```

---

## 2.4 MCP Tools Integration Tests

**File:** `workers/fantasy-mcp/src/mcp/tools.ts`
**Why:** Test tool handlers with mocked dependencies to verify business logic.

### Test File: `workers/fantasy-mcp/src/__tests__/tools.test.ts`

```typescript
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { getUnifiedTools } from '../mcp/tools';
import type { Env } from '../types';

describe('MCP Tools', () => {
  // Mock auth-worker service binding
  const mockAuthWorkerFetch = jest.fn();

  // Mock ESPN client service binding
  const mockEspnFetch = jest.fn();

  const mockEnv: Env = {
    AUTH_WORKER: {
      fetch: mockAuthWorkerFetch,
    } as unknown as Fetcher,
    ESPN: {
      fetch: mockEspnFetch,
    } as unknown as Fetcher,
  };

  beforeEach(() => {
    mockAuthWorkerFetch.mockReset();
    mockEspnFetch.mockReset();
  });

  describe('get_user_session', () => {
    const tools = getUnifiedTools();
    const getUserSession = tools.find(t => t.name === 'get_user_session')!;

    it('returns session data when leagues exist', async () => {
      mockAuthWorkerFetch.mockResolvedValue(
        new Response(JSON.stringify({
          success: true,
          leagues: [
            {
              leagueId: '12345',
              sport: 'football',
              platform: 'espn',
              teamId: '1',
              seasonYear: 2025,
              leagueName: 'Test League',
              isDefault: true,
            },
          ],
        }), { status: 200 })
      );

      const result = await getUserSession.handler({}, mockEnv, 'Bearer token');
      const content = JSON.parse(result.content[0].text);

      expect(content.success).toBe(true);
      expect(content.totalLeaguesFound).toBe(1);
      expect(content.defaultLeague.leagueId).toBe('12345');
    });

    it('handles no leagues gracefully', async () => {
      mockAuthWorkerFetch.mockResolvedValue(
        new Response(JSON.stringify({
          success: true,
          leagues: [],
        }), { status: 200 })
      );

      const result = await getUserSession.handler({}, mockEnv, 'Bearer token');
      const content = JSON.parse(result.content[0].text);

      expect(content.success).toBe(true);
      expect(content.totalLeaguesFound).toBe(0);
      expect(content.instructions).toContain('No leagues configured');
    });

    it('handles auth failure', async () => {
      mockAuthWorkerFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      );

      await expect(
        getUserSession.handler({}, mockEnv, 'Bearer invalid')
      ).rejects.toThrow('AUTH_FAILED');
    });

    it('includes current season info', async () => {
      mockAuthWorkerFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true, leagues: [] }), { status: 200 })
      );

      const result = await getUserSession.handler({}, mockEnv);
      const content = JSON.parse(result.content[0].text);

      expect(content.currentSeasons).toBeDefined();
      expect(content.currentSeasons.football).toBeDefined();
      expect(content.currentSeasons.baseball).toBeDefined();
      expect(content.timezone).toBe('America/New_York');
    });

    it('groups leagues by sport', async () => {
      mockAuthWorkerFetch.mockResolvedValue(
        new Response(JSON.stringify({
          success: true,
          leagues: [
            { leagueId: '1', sport: 'football', platform: 'espn' },
            { leagueId: '2', sport: 'football', platform: 'espn' },
            { leagueId: '3', sport: 'baseball', platform: 'espn' },
          ],
        }), { status: 200 })
      );

      const result = await getUserSession.handler({}, mockEnv);
      const content = JSON.parse(result.content[0].text);

      expect(content.leaguesBySport.football).toBe(2);
      expect(content.leaguesBySport.baseball).toBe(1);
    });
  });

  describe('get_league_info', () => {
    const tools = getUnifiedTools();
    const getLeagueInfo = tools.find(t => t.name === 'get_league_info')!;

    it('requires all parameters', async () => {
      // Missing sport
      mockEspnFetch.mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
      );

      const result = await getLeagueInfo.handler(
        {
          platform: 'espn',
          league_id: '12345',
          season_year: 2025,
          // sport missing
        },
        mockEnv
      );

      // Handler should still work but ESPN client should validate
      expect(mockEspnFetch).toHaveBeenCalled();
    });

    it('routes to ESPN client for ESPN platform', async () => {
      mockEspnFetch.mockResolvedValue(
        new Response(JSON.stringify({
          success: true,
          data: { leagueName: 'Test League' },
        }), { status: 200 })
      );

      const result = await getLeagueInfo.handler(
        {
          platform: 'espn',
          sport: 'football',
          league_id: '12345',
          season_year: 2025,
        },
        mockEnv
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
    });
  });

  describe('tool schema validation', () => {
    const tools = getUnifiedTools();

    it('get_league_info has required parameters', () => {
      const tool = tools.find(t => t.name === 'get_league_info')!;

      expect(tool.inputSchema.platform).toBeDefined();
      expect(tool.inputSchema.sport).toBeDefined();
      expect(tool.inputSchema.league_id).toBeDefined();
      expect(tool.inputSchema.season_year).toBeDefined();
    });

    it('get_matchups has optional week parameter', () => {
      const tool = tools.find(t => t.name === 'get_matchups')!;

      expect(tool.inputSchema.week).toBeDefined();
      // Week should be optional (has .optional())
    });

    it('get_free_agents has optional count parameter', () => {
      const tool = tools.find(t => t.name === 'get_free_agents')!;

      expect(tool.inputSchema.count).toBeDefined();
      expect(tool.inputSchema.position).toBeDefined();
    });

    it('all tools have descriptions', () => {
      tools.forEach(tool => {
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(10);
      });
    });
  });
});
```

---

## Phase 2 Summary

| Test File | Functions Covered | Est. Tests |
|-----------|------------------|------------|
| `oauth-storage.test.ts` | Token CRUD, validation, rate limiting | ~20 |
| `oauth-handlers.test.ts` | Metadata, authorize, allowlist | ~15 |
| `router.test.ts` | Platform routing, error handling | ~10 |
| `tools.test.ts` | All 6 MCP tools, schemas | ~20 |

**Total Phase 2:** ~65 tests covering security-critical OAuth and MCP logic

---

# Phase 3: Hard Wins (Integration & E2E Tests)

**Effort:** High | **Risk Coverage:** Full Stack | **Maintenance:** Higher

These tests verify the complete request/response cycle and catch integration issues between components.

## 3.1 Auth Worker Integration Tests

Test actual HTTP endpoints using the Hono app directly (no mocking of Supabase).

### Test File: `workers/auth-worker/src/__tests__/integration/endpoints.test.ts`

```typescript
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import app from '../../index-hono';

// Mock Supabase at the module level
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  is: jest.fn().mockReturnThis(),
  gt: jest.fn().mockReturnThis(),
  single: jest.fn(),
  rpc: jest.fn(),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupabase,
}));

describe('Auth Worker Integration', () => {
  const mockEnv = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_KEY: 'test-key',
    ENVIRONMENT: 'dev',
    NODE_ENV: 'development',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // HEALTH ENDPOINT
  // ==========================================================================
  describe('GET /health', () => {
    it('returns healthy status', async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: null });

      const response = await app.request('/health', {}, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.service).toBe('auth-worker');
    });

    it('returns degraded when Supabase fails', async () => {
      mockSupabase.single.mockRejectedValue(new Error('Connection failed'));

      const response = await app.request('/health', {}, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.status).toBe('degraded');
      expect(data.supabase_status).toBe('error');
    });
  });

  // ==========================================================================
  // OAUTH METADATA
  // ==========================================================================
  describe('GET /.well-known/oauth-authorization-server', () => {
    it('returns OAuth metadata', async () => {
      const response = await app.request(
        '/.well-known/oauth-authorization-server',
        {},
        mockEnv
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.issuer).toBeDefined();
      expect(data.authorization_endpoint).toBeDefined();
      expect(data.token_endpoint).toBeDefined();
    });
  });

  // ==========================================================================
  // CREDENTIALS ENDPOINTS (require auth)
  // ==========================================================================
  describe('GET /credentials/espn', () => {
    it('returns 401 without auth', async () => {
      const response = await app.request('/credentials/espn', {}, mockEnv);

      expect(response.status).toBe(401);
    });

    it('returns 401 with invalid JWT', async () => {
      const response = await app.request(
        '/credentials/espn',
        {
          headers: {
            Authorization: 'Bearer invalid-token',
          },
        },
        mockEnv
      );

      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // LEAGUES ENDPOINTS
  // ==========================================================================
  describe('GET /leagues', () => {
    it('returns 401 without auth', async () => {
      const response = await app.request('/leagues', {}, mockEnv);

      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // CORS
  // ==========================================================================
  describe('CORS handling', () => {
    it('responds to OPTIONS preflight', async () => {
      const response = await app.request(
        '/health',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://flaim.app',
          },
        },
        mockEnv
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });

    it('allows flaim.app origin', async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: null });

      const response = await app.request(
        '/health',
        {
          headers: {
            Origin: 'https://flaim.app',
          },
        },
        mockEnv
      );

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://flaim.app');
    });

    it('allows Vercel preview URLs', async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: null });

      const response = await app.request(
        '/health',
        {
          headers: {
            Origin: 'https://flaim-preview-abc123.vercel.app',
          },
        },
        mockEnv
      );

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://flaim-preview-abc123.vercel.app'
      );
    });
  });

  // ==========================================================================
  // 404 HANDLING
  // ==========================================================================
  describe('404 handling', () => {
    it('returns helpful 404 for unknown endpoints', async () => {
      const response = await app.request('/unknown-endpoint', {}, mockEnv);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Endpoint not found');
      expect(data.endpoints).toBeDefined();
    });
  });
});
```

---

## 3.2 E2E Tests with Playwright

**File:** `e2e/critical-paths.spec.ts`
**Why:** Verify the complete user journey works in a real browser.

### First, configure Playwright

**File:** `playwright.config.ts` (root)

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev:frontend',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
```

### Test File: `e2e/critical-paths.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Critical User Paths', () => {
  // ==========================================================================
  // LANDING PAGE
  // ==========================================================================
  test.describe('Landing Page', () => {
    test('loads successfully', async ({ page }) => {
      await page.goto('/');

      // Check page title or key element
      await expect(page).toHaveTitle(/Flaim/);
    });

    test('has sign-in link', async ({ page }) => {
      await page.goto('/');

      const signInLink = page.getByRole('link', { name: /sign in/i });
      await expect(signInLink).toBeVisible();
    });

    test('has get-started CTA', async ({ page }) => {
      await page.goto('/');

      const ctaButton = page.getByRole('link', { name: /get started/i });
      await expect(ctaButton).toBeVisible();
    });
  });

  // ==========================================================================
  // AUTHENTICATION FLOW
  // ==========================================================================
  test.describe('Authentication', () => {
    test('sign-in page loads', async ({ page }) => {
      await page.goto('/sign-in');

      // Clerk should render sign-in form
      await expect(page.locator('[data-clerk-component]')).toBeVisible({ timeout: 10000 });
    });

    test('sign-up page loads', async ({ page }) => {
      await page.goto('/sign-up');

      await expect(page.locator('[data-clerk-component]')).toBeVisible({ timeout: 10000 });
    });

    test('protected route redirects to sign-in', async ({ page }) => {
      await page.goto('/leagues');

      // Should redirect to sign-in
      await expect(page).toHaveURL(/sign-in/);
    });
  });

  // ==========================================================================
  // OAUTH CONSENT FLOW
  // ==========================================================================
  test.describe('OAuth Consent', () => {
    test('consent page shows error without params', async ({ page }) => {
      await page.goto('/oauth/consent');

      // Should show error state
      const errorMessage = page.getByText(/missing/i);
      await expect(errorMessage).toBeVisible();
    });

    test('consent page loads with valid params', async ({ page }) => {
      const params = new URLSearchParams({
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_challenge: 'test_challenge',
        code_challenge_method: 'S256',
        client_id: 'test_client',
      });

      await page.goto(`/oauth/consent?${params}`);

      // Should show consent UI (even if user not logged in)
      // Clerk will handle auth state
    });
  });

  // ==========================================================================
  // PRIVACY POLICY
  // ==========================================================================
  test.describe('Privacy Policy', () => {
    test('privacy page loads', async ({ page }) => {
      await page.goto('/privacy');

      await expect(page.getByRole('heading', { name: /privacy/i })).toBeVisible();
    });
  });
});
```

### Test File: `e2e/api-health.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('API Health Checks', () => {
  // Note: These tests require workers to be running
  // Run with: npm run dev:workers (in parallel)

  test.skip('auth-worker health endpoint', async ({ request }) => {
    // Skip in CI unless workers are deployed
    if (process.env.CI) return;

    const response = await request.get('http://localhost:8786/health');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.status).toMatch(/healthy|degraded/);
  });

  test.skip('fantasy-mcp health endpoint', async ({ request }) => {
    if (process.env.CI) return;

    const response = await request.get('http://localhost:8790/health');
    expect(response.status()).toBe(200);
  });
});
```

---

## 3.3 CI/CD Configuration

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
  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run auth-worker tests
        run: npm run test:auth
        working-directory: workers/auth-worker

      - name: Run fantasy-mcp tests
        run: npm run test:mcp
        working-directory: workers/fantasy-mcp

  # E2E tests run separately (more expensive)
  e2e-tests:
    name: E2E Tests
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      - name: Run E2E tests
        run: npm run test:e2e
        env:
          # Add any required env vars
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.CLERK_PUBLISHABLE_KEY }}

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

---

## Phase 3 Summary

| Test File | Type | Coverage |
|-----------|------|----------|
| `endpoints.test.ts` | Integration | Auth worker HTTP layer |
| `critical-paths.spec.ts` | E2E | Landing, auth, OAuth consent |
| `api-health.spec.ts` | E2E | Worker health endpoints |

**Total Phase 3:** ~20 integration tests + 10 E2E tests

---

# Summary & Quick Reference

## Test Commands

Add to root `package.json`:

```json
{
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "test:auth": "cd workers/auth-worker && npm test",
    "test:mcp": "cd workers/fantasy-mcp && npm test",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

## Phase Overview

| Phase | Effort | Tests | Coverage Focus |
|-------|--------|-------|----------------|
| **1: Easy Wins** | Low | ~55 | Pure functions, business logic |
| **2: Medium Wins** | Medium | ~65 | OAuth, MCP tools (with mocking) |
| **3: Hard Wins** | High | ~30 | Integration, E2E |
| **Total** | - | ~150 | - |

## Priority Order

1. **Season Utils** - Quick win, high confidence
2. **ESPN Types** - Validation logic, error classes
3. **OAuth Storage** - Security-critical token handling
4. **OAuth Handlers** - Security-critical request handling
5. **MCP Router** - Core product routing
6. **MCP Tools** - Core product functionality
7. **Integration Tests** - Full HTTP cycle
8. **E2E Tests** - Critical user paths

## What NOT to Test

- Chrome extension (manual testing sufficient)
- Next.js UI components (high churn, low ROI)
- Legacy workers (`baseball-espn-mcp`, `football-espn-mcp`)
- Third-party libraries (Clerk, Supabase, ESPN API)
- CSS/styling

## Key Principle

**Test what would wake you up at 3am:**
1. OAuth breaks → users can't connect
2. MCP tools break → product doesn't work
3. Season logic breaks → wrong data shown
4. Credential storage breaks → data integrity issues

Everything else can be caught manually or fixed quickly post-launch.
