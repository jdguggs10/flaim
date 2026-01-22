# Automated Testing & CI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add CI test automation and high-value unit tests for active workers (auth-worker, espn-client, fantasy-mcp).

**Architecture:** Tests run in GitHub Actions before deploy. auth-worker already has Jest configured with 14 passing tests. We'll add a test job to CI, then add season-utils and espn-types tests to auth-worker.

**Tech Stack:** Jest 30, ts-jest, GitHub Actions

---

## Task 1: Add Test Job to GitHub Actions

**Files:**
- Modify: `.github/workflows/deploy-workers.yml`

**Step 1: Update workflow to add test job**

Replace the entire file with:

```yaml
name: Deploy Workers

on:
  push:
    branches:
      - main
  pull_request:

jobs:
  test:
    name: Run Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Test auth-worker
        run: npm test
        working-directory: workers/auth-worker

  deploy:
    name: Deploy ${{ matrix.worker }}
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' || github.event_name == 'pull_request'
    strategy:
      matrix:
        worker: [auth-worker, baseball-espn-mcp, football-espn-mcp, espn-client, fantasy-mcp]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Deploy ${{ matrix.worker }}
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: workers/${{ matrix.worker }}
          command: deploy --env ${{ github.ref == 'refs/heads/main' && 'prod' || 'preview' }}
```

**Step 2: Verify the change locally**

Run: `cat .github/workflows/deploy-workers.yml | head -30`
Expected: See the new `test` job at the top

**Step 3: Commit**

```bash
git add .github/workflows/deploy-workers.yml
git commit -m "ci: add test job before deploy"
```

---

## Task 2: Add Season Utils Tests

**Files:**
- Create: `workers/auth-worker/src/__tests__/season-utils.test.ts`
- Reference: `workers/auth-worker/src/season-utils.ts`

**Step 1: Write the test file**

Create `workers/auth-worker/src/__tests__/season-utils.test.ts`:

```typescript
import { describe, expect, it } from '@jest/globals';
import { getDefaultSeasonYear, isCurrentSeason, SeasonSport } from '../season-utils';

describe('season-utils', () => {
  describe('getDefaultSeasonYear', () => {
    // Baseball: rolls over Feb 1
    describe('baseball', () => {
      it('returns previous year before Feb 1', () => {
        const jan15 = new Date('2026-01-15T12:00:00-05:00');
        expect(getDefaultSeasonYear('baseball', jan15)).toBe(2025);
      });

      it('returns current year on Feb 1', () => {
        const feb1 = new Date('2026-02-01T00:00:00-05:00');
        expect(getDefaultSeasonYear('baseball', feb1)).toBe(2026);
      });

      it('returns current year after Feb 1', () => {
        const mar15 = new Date('2026-03-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('baseball', mar15)).toBe(2026);
      });
    });

    // Football: rolls over Jun 1
    describe('football', () => {
      it('returns previous year before Jun 1', () => {
        const may15 = new Date('2026-05-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('football', may15)).toBe(2025);
      });

      it('returns current year on Jun 1', () => {
        const jun1 = new Date('2026-06-01T00:00:00-04:00');
        expect(getDefaultSeasonYear('football', jun1)).toBe(2026);
      });

      it('returns current year in January (post-playoffs)', () => {
        const jan15 = new Date('2026-01-15T12:00:00-05:00');
        expect(getDefaultSeasonYear('football', jan15)).toBe(2025);
      });
    });

    // Basketball: rolls over Oct 1
    describe('basketball', () => {
      it('returns previous year before Oct 1', () => {
        const sep15 = new Date('2026-09-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('basketball', sep15)).toBe(2025);
      });

      it('returns current year on Oct 1', () => {
        const oct1 = new Date('2026-10-01T00:00:00-04:00');
        expect(getDefaultSeasonYear('basketball', oct1)).toBe(2026);
      });
    });

    // Hockey: rolls over Oct 1
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

    // Edge cases
    describe('edge cases', () => {
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
      const jan15 = new Date('2026-01-15T12:00:00-05:00');
      expect(isCurrentSeason('football', 2025, jan15)).toBe(true);
      expect(isCurrentSeason('football', 2026, jan15)).toBe(false);
    });
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `cd workers/auth-worker && npm test -- --testPathPattern=season-utils`
Expected: All tests PASS

**Step 3: Run full test suite**

Run: `cd workers/auth-worker && npm test`
Expected: All 14 + new tests PASS

**Step 4: Commit**

```bash
git add workers/auth-worker/src/__tests__/season-utils.test.ts
git commit -m "test(auth-worker): add season-utils tests"
```

---

## Task 3: Add ESPN Types Tests

**Files:**
- Create: `workers/auth-worker/src/__tests__/espn-types.test.ts`
- Reference: `workers/auth-worker/src/espn-types.ts`

**Step 1: Write the test file**

Create `workers/auth-worker/src/__tests__/espn-types.test.ts`:

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
  // Type guards
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
    });
  });

  // Conversion functions
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

  // Credential validation
  describe('validateEspnCredentials', () => {
    const validSwid = '{BFA3386F-9501-4F4A-88C7-C56D6BB86C11}';
    const validS2 = 'AEBx7jHLKx%2BLJYkzS7QYz%2BTZo4PnxxxxxXXXXxxxxXXXXabcdefghij';

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
  });

  // Error classes
  describe('error classes', () => {
    it('EspnCredentialsRequired has correct name and default message', () => {
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

  // Constants
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

**Step 2: Run tests to verify they pass**

Run: `cd workers/auth-worker && npm test -- --testPathPattern=espn-types`
Expected: All tests PASS

**Step 3: Run full test suite**

Run: `cd workers/auth-worker && npm test`
Expected: All tests PASS (14 existing + season-utils + espn-types)

**Step 4: Commit**

```bash
git add workers/auth-worker/src/__tests__/espn-types.test.ts
git commit -m "test(auth-worker): add espn-types tests"
```

---

## Task 4: Push and Verify CI

**Files:** None (verification only)

**Step 1: Push branch to trigger CI**

Run: `git push origin claude/testing-strategy-review-xwZLL`

**Step 2: Check CI status**

Run: `gh run list --limit 3`
Expected: See a new workflow run in progress or completed

**Step 3: View test job results**

Run: `gh run view --log | head -100` (or check GitHub Actions tab in browser)
Expected: Test job passes, deploy job runs after

---

## Task 5: Clean Up Testing Strategy Doc (Optional)

**Files:**
- Delete or archive: `docs/TESTING_STRATEGY.md` (the 1900-line doc)

**Step 1: Decide what to do with the doc**

The comprehensive doc served as a reference for writing tests. Now that tests are implemented, options:
- Keep as reference
- Delete (tests are the documentation now)
- Archive to `docs/archive/`

**Step 2: If archiving**

```bash
mkdir -p docs/archive
mv docs/TESTING_STRATEGY.md docs/archive/
git add docs/archive/TESTING_STRATEGY.md
git rm docs/TESTING_STRATEGY.md
git commit -m "docs: archive testing strategy (tests implemented)"
```

---

## Summary

| Task | Tests Added | Cumulative Total |
|------|-------------|------------------|
| Existing | 14 | 14 |
| Task 2: season-utils | ~15 | ~29 |
| Task 3: espn-types | ~20 | ~49 |

**After completion:**
- Tests run automatically on every push/PR
- Deploy blocked if tests fail
- ~49 tests covering business logic, validation, and error handling
- No legacy worker tests (as requested)
