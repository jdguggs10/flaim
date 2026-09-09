import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Write-path doubles. Inspect must never construct storage or sync-state, let
// alone call a write on either; these spies turn "read-only" into an assertion
// rather than a comment.
const writeSpies = vi.hoisted(() => ({
  yahooStorageConstructed: vi.fn(),
  upsertYahooLeague: vi.fn(),
  syncStateConstructed: vi.fn(),
  settle: vi.fn(),
  acquireLease: vi.fn(),
}));

vi.mock('../yahoo-storage', async () => {
  const actual = await vi.importActual<typeof import('../yahoo-storage')>('../yahoo-storage');
  class MockYahooStorage {
    upsertYahooLeague = writeSpies.upsertYahooLeague;
    getYahooCredentialHealth = vi.fn().mockResolvedValue(null);
    constructor(...args: unknown[]) {
      writeSpies.yahooStorageConstructed(...args);
    }
    static fromEnvironment(): MockYahooStorage {
      return new MockYahooStorage();
    }
  }
  return { ...actual, YahooStorage: MockYahooStorage };
});

vi.mock('../sync-state', async () => {
  const actual = await vi.importActual<typeof import('../sync-state')>('../sync-state');
  class MockSyncStateStorage {
    settle = writeSpies.settle;
    acquireLease = writeSpies.acquireLease;
    constructor(...args: unknown[]) {
      writeSpies.syncStateConstructed(...args);
    }
  }
  return { ...actual, SyncStateStorage: MockSyncStateStorage };
});

import { runYahooSupportInspect, type YahooSupportEnv } from '../yahoo-support-diagnostics';
import type { readYahooCredentialHealthReport } from '../yahoo-connect-handlers';

const USER_ID = 'user_3Ie4m68lUbzxyv22NsMU';
const MASKED_USER_ID = 'user_3Ie...';
const NOW_MS = Date.parse('2026-09-09T15:00:00.000Z');
const CHECKED_AT = '2026-09-09T15:00:00.000Z';

const env: YahooSupportEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  YAHOO_CLIENT_ID: 'test-client-id',
};

// Values that must never reach the report or the audit log. The fake client
// hands these back alongside the requested columns, so a select that widened —
// or an implementation that spread a raw row — fails loudly.
const FORBIDDEN = {
  leagueKey: '449.l.987654',
  leagueName: 'Sentinel Dynasty League',
  teamName: 'Sentinel Sunday Squad',
  teamKey: '449.l.987654.t.7',
  accessToken: 'ya29-sentinel-access-token',
  refreshToken: 'sentinel-refresh-token',
  leaseOwner: 'sentinel-lease-owner-id',
  errorMessage: 'duplicate key value violates unique constraint (449.l.987654)',
} as const;

type TableFixture = { data?: unknown[] | null; count?: number | null; error?: unknown };
type SelectCall = { table: string; columns: string; options?: unknown };

function fakeSupabase(fixtures: Record<string, TableFixture>) {
  const selectCalls: SelectCall[] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string, options?: unknown) {
          selectCalls.push({ table, columns, options });
          const fixture = fixtures[table] ?? {};
          const data = fixture.data ?? [];
          const result = {
            data: fixture.error ? null : data,
            count: fixture.error ? null : fixture.count ?? data.length,
            error: fixture.error ?? null,
          };
          const builder: Record<string, unknown> = {
            eq: () => builder,
            is: () => builder,
            gt: () => builder,
            limit: () => builder,
            then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject),
          };
          return builder;
        },
      };
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    selectCalls,
    columnsFor: (table: string) => selectCalls.filter((call) => call.table === table).map((call) => call.columns),
  };
}

/** A rich, realistic fixture whose rows also carry every forbidden column. */
function richFixtures(): Record<string, TableFixture> {
  return {
    yahoo_credentials: { data: [{ clerk_user_id: USER_ID }] },
    espn_credentials: { data: [{ clerk_user_id: USER_ID }] },
    sleeper_connections: { data: [] },
    yahoo_leagues: {
      count: 3,
      data: [
        {
          season_year: 2025,
          updated_at: '2026-08-01T10:00:00.000Z',
          league_key: FORBIDDEN.leagueKey,
          league_name: FORBIDDEN.leagueName,
          team_name: FORBIDDEN.teamName,
          team_key: FORBIDDEN.teamKey,
        },
        { season_year: 2026, updated_at: '2026-09-01T10:00:00.000Z', league_name: FORBIDDEN.leagueName },
        { season_year: 2026, updated_at: '2026-07-01T10:00:00.000Z', league_key: FORBIDDEN.leagueKey },
      ],
    },
    provider_sync_state: {
      data: [
        {
          provider: 'yahoo',
          last_attempt_at: '2026-09-08T20:00:00.000Z',
          last_success_at: null,
          last_failure_at: '2026-09-08T20:00:01.000Z',
          last_error_code: 'yahoo_api_temporarily_unavailable',
          last_league_count: 0,
          last_duration_ms: 1234,
          last_sync_source: 'scheduled',
          sync_lease_expires_at: null,
          sync_lease_owner: FORBIDDEN.leaseOwner,
          last_error_message: FORBIDDEN.errorMessage,
        },
        {
          provider: 'espn',
          last_attempt_at: '2026-09-07T20:00:00.000Z',
          last_success_at: '2026-09-07T20:00:05.000Z',
          last_failure_at: null,
          last_error_code: null,
          last_league_count: 2,
          last_duration_ms: 900,
          last_sync_source: 'web',
          sync_lease_expires_at: null,
        },
      ],
    },
    oauth_tokens: {
      count: 2,
      data: [
        {
          expires_at: '2026-10-01T00:00:00.000Z',
          client_name: 'Claude',
          access_token: FORBIDDEN.accessToken,
          refresh_token: FORBIDDEN.refreshToken,
        },
        { expires_at: '2026-12-01T00:00:00.000Z', client_name: 'ChatGPT' },
        { expires_at: '2026-11-01T00:00:00.000Z', client_name: 'Claude' },
      ],
    },
  };
}

function credentialReport(
  overrides: Partial<{ status: 'match' | 'mismatch' | 'unknown' }> = {}
): Awaited<ReturnType<typeof readYahooCredentialHealthReport>> {
  return {
    connected: true,
    hasCredentials: true,
    platform: 'yahoo',
    checkedAt: CHECKED_AT,
    lastUpdated: '2026-09-08T12:00:00.000Z',
    yahooGuidPresent: true,
    appFingerprint: {
      stored: 'aaaaaaaaaaaa',
      runtime: overrides.status === 'mismatch' ? 'bbbbbbbbbbbb' : 'aaaaaaaaaaaa',
      status: overrides.status ?? 'match',
    },
    accessToken: {
      expiresAt: '2026-09-09T16:00:00.000Z',
      expiresInSeconds: 3600,
      needsRefresh: false,
      state: 'fresh',
    },
    refresh: { state: 'idle' },
  };
}

function stubCredentialHealth(value: Awaited<ReturnType<typeof readYahooCredentialHealthReport>>) {
  return vi.fn<typeof readYahooCredentialHealthReport>().mockResolvedValue(value);
}

/** Every string reachable from an arbitrary JSON-ish value. */
function deepStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) deepStrings(entry, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      found.push(key);
      deepStrings(entry, found);
    }
  }
  return found;
}

let fetchSpy: ReturnType<typeof vi.fn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Any credential renewal would have to reach Yahoo's token endpoint. Inspect
  // makes no outbound request at all.
  fetchSpy = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetchSpy);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function run(
  fixtures: Record<string, TableFixture>,
  credentialHealth = stubCredentialHealth(credentialReport())
) {
  const supabase = fakeSupabase(fixtures);
  return {
    supabase,
    credentialHealth,
    result: runYahooSupportInspect(
      env,
      { userId: USER_ID },
      { now: () => NOW_MS, supabase: supabase.client, credentialHealth }
    ),
  };
}

describe('runYahooSupportInspect', () => {
  it('projects a complete snapshot from stored state', async () => {
    const report = await run(richFixtures()).result;

    expect(report).toEqual({
      outcome: 'ok',
      userMasked: MASKED_USER_ID,
      checkedAt: CHECKED_AT,
      providers: { yahoo: true, espn: true, sleeper: false },
      yahooCredential: credentialReport(),
      yahooLeagues: {
        rowCount: 3,
        distinctSeasons: 2,
        oldestUpdatedAt: '2026-07-01T10:00:00.000Z',
        newestUpdatedAt: '2026-09-01T10:00:00.000Z',
      },
      sync: [
        {
          provider: 'espn',
          lastAttemptAt: '2026-09-07T20:00:00.000Z',
          lastSuccessAt: '2026-09-07T20:00:05.000Z',
          lastFailureAt: null,
          lastErrorCode: null,
          lastLeagueCount: 2,
          lastDurationMs: 900,
          lastSyncSource: 'web',
          syncLeaseExpiresAt: null,
        },
        {
          provider: 'yahoo',
          lastAttemptAt: '2026-09-08T20:00:00.000Z',
          lastSuccessAt: null,
          lastFailureAt: '2026-09-08T20:00:01.000Z',
          lastErrorCode: 'yahoo_api_temporarily_unavailable',
          lastLeagueCount: 0,
          lastDurationMs: 1234,
          lastSyncSource: 'scheduled',
          syncLeaseExpiresAt: null,
        },
      ],
      flaimSessions: {
        activeCount: 2,
        mostRecentExpiresAt: '2026-12-01T00:00:00.000Z',
        clientNames: ['ChatGPT', 'Claude'],
      },
    });
  });

  it('never renews a credential: it reads stored health once and makes no outbound request', async () => {
    const { credentialHealth, result } = run(richFixtures());
    await result;

    expect(credentialHealth).toHaveBeenCalledTimes(1);
    expect(credentialHealth).toHaveBeenCalledWith(env, USER_ID, new Date(NOW_MS));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never touches sync state', async () => {
    await run(richFixtures()).result;

    expect(writeSpies.syncStateConstructed).not.toHaveBeenCalled();
    expect(writeSpies.settle).not.toHaveBeenCalled();
    expect(writeSpies.acquireLease).not.toHaveBeenCalled();
  });

  it('never writes leagues', async () => {
    await run(richFixtures()).result;

    expect(writeSpies.upsertYahooLeague).not.toHaveBeenCalled();
    expect(writeSpies.yahooStorageConstructed).not.toHaveBeenCalled();
  });

  it('names every column it reads and never selects an identifier or a token', async () => {
    const { supabase, result } = run(richFixtures());
    await result;

    const guardedTables = ['oauth_tokens', 'yahoo_leagues', 'provider_sync_state', 'yahoo_credentials',
      'espn_credentials', 'sleeper_connections'];
    const forbiddenColumns = ['*', 'access_token', 'refresh_token', 'league_key', 'league_name', 'team_name',
      'team_key', 'sync_lease_owner', 'last_error_message'];

    for (const table of guardedTables) {
      const columns = supabase.columnsFor(table);
      expect(columns.length).toBeGreaterThan(0);
      for (const selected of columns) {
        for (const forbidden of forbiddenColumns) {
          expect(selected).not.toContain(forbidden);
        }
      }
    }

    expect(supabase.columnsFor('oauth_tokens')).toEqual(['expires_at,client_name']);
    expect(supabase.columnsFor('yahoo_leagues')).toEqual(['season_year,updated_at']);
  });

  it('reports a clean disconnected credential when there is no credential row', async () => {
    const fixtures = richFixtures();
    fixtures.yahoo_credentials = { data: [] };
    const report = await run(fixtures, stubCredentialHealth(null)).result;

    expect(report).toMatchObject({
      outcome: 'ok',
      providers: { yahoo: false },
      yahooCredential: { connected: false, hasCredentials: false },
    });
  });

  it('surfaces an app-fingerprint mismatch from the credential-health report', async () => {
    const report = await run(
      richFixtures(),
      stubCredentialHealth(credentialReport({ status: 'mismatch' }))
    ).result;

    expect(report).toMatchObject({
      outcome: 'ok',
      yahooCredential: { appFingerprint: { status: 'mismatch' } },
    });
  });

  it('returns a clean snapshot_failed when a read fails', async () => {
    const fixtures = richFixtures();
    fixtures.oauth_tokens = { error: { code: 'PGRST301', message: `row ${FORBIDDEN.leagueKey}` } };
    const report = await run(fixtures).result;

    expect(report).toEqual({ outcome: 'failed', userMasked: MASKED_USER_ID, error: 'snapshot_failed' });
  });

  it('writes one audit line that masks the user id and carries no customer data', async () => {
    await run(richFixtures()).result;

    const auditLines = logSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('yahoo_support_inspect'));
    expect(auditLines).toHaveLength(1);

    const audit = JSON.parse(auditLines[0]) as Record<string, unknown>;
    expect(audit).toMatchObject({
      event: 'yahoo_support_inspect',
      service: 'auth-worker',
      user_id: MASKED_USER_ID,
      outcome: 'ok',
    });
    expect(typeof audit.correlation_id).toBe('string');

    expect(auditLines[0]).not.toContain(USER_ID);
    for (const forbidden of Object.values(FORBIDDEN)) {
      expect(auditLines[0]).not.toContain(forbidden);
    }
  });

  it('leaks no customer league or team identifier anywhere in the report', async () => {
    const report = await run(richFixtures()).result;

    const strings = deepStrings(report);
    for (const forbidden of Object.values(FORBIDDEN)) {
      for (const value of strings) {
        expect(value).not.toContain(forbidden);
      }
    }
    // Also pin the shape: no forbidden key survived into the report tree.
    for (const key of ['league_key', 'league_name', 'team_name', 'team_key', 'access_token', 'refresh_token',
      'sync_lease_owner', 'last_error_message']) {
      expect(strings).not.toContain(key);
    }
    expect(JSON.stringify(report)).not.toContain(USER_ID);
  });
});
