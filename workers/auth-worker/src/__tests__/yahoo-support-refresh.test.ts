import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Refresh (FLA-360): the one support action that persists.
 *
 * It owns none of that persistence — it calls `refreshLeaguesForUser` with a
 * scheduled sync's own arguments — so these tests pin the two things that are
 * actually this module's: the exact call it makes, and the before/after proof
 * it reports around it. Entirely offline; the refresh itself is injected.
 */

import {
  runYahooSupportRefresh,
  type YahooSupportEnv,
} from '../yahoo-support-diagnostics';
import type { LeagueRefreshResponse, ProviderRefreshResult, refreshLeaguesForUser } from '../league-refresh';

const USER_ID = 'user_3Ie4m68lUbzxyv22NsMU';
const MASKED_USER_ID = 'user_3Ie...';
const NOW_MS = Date.parse('2026-09-09T15:00:00.000Z');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const env: YahooSupportEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  YAHOO_CLIENT_ID: 'test-client-id',
};

/**
 * Customer- and secret-shaped strings. They are planted in the provider result's
 * free-form fields and in the rows the fake client hands back, so a widened
 * select or a projection that spread a raw object fails loudly.
 */
const FORBIDDEN = {
  leagueKey: '449.l.987654',
  leagueName: 'Sentinel Dynasty League',
  teamName: 'Sentinel Sunday Squad',
  teamKey: '449.l.987654.t.7',
  accessToken: 'ya29-sentinel-access-token',
  refreshToken: 'sentinel-refresh-token',
  leaseOwner: 'sentinel-lease-owner-id',
  upstreamBody:
    '<html><body>Yahoo error for league 449.l.987654 owned by Sentinel Sunday Squad</body></html>',
  errorMessage: 'duplicate key value violates unique constraint (449.l.987654)',
} as const;

// ---------------------------------------------------------------------------
// Fake Supabase + saved-state model
// ---------------------------------------------------------------------------

type TableFixture = { data?: unknown[] | null; count?: number | null; error?: unknown };
type SelectCall = { table: string; columns: string; options?: unknown };

/** The saved rows the account has right now; the injected refresh mutates it. */
type SavedState = {
  leagueRows: number;
  syncRow: Record<string, unknown> | null;
  failTables: Set<string>;
};

function savedState(overrides: Partial<SavedState> = {}): SavedState {
  return {
    leagueRows: 0,
    syncRow: {
      provider: 'yahoo',
      last_attempt_at: '2026-09-09T03:13:44.854Z',
      last_success_at: '2026-09-09T03:13:45.784Z',
      last_failure_at: '2026-09-05T20:10:28.099Z',
      last_error_code: null,
      last_league_count: 0,
      last_duration_ms: 733,
      last_sync_source: 'web',
      sync_lease_expires_at: null,
      // Never selected, so never reachable — planted to prove it.
      sync_lease_owner: FORBIDDEN.leaseOwner,
      last_error_message: FORBIDDEN.errorMessage,
    },
    failTables: new Set<string>(),
    ...overrides,
  };
}

/** League rows always carry the identifiers an over-wide select would expose. */
function leagueRowsFor(count: number): unknown[] {
  return Array.from({ length: count }, (_unused, index) => ({
    season_year: 2026,
    updated_at: '2026-09-09T15:00:00.000Z',
    league_key: `${FORBIDDEN.leagueKey}.${index}`,
    league_name: FORBIDDEN.leagueName,
    team_name: FORBIDDEN.teamName,
    team_key: FORBIDDEN.teamKey,
  }));
}

function fixturesFor(state: SavedState): Record<string, TableFixture> {
  return {
    yahoo_leagues: state.failTables.has('yahoo_leagues')
      ? { error: { code: 'PGRST301', message: `row ${FORBIDDEN.leagueKey}` } }
      : { count: state.leagueRows, data: leagueRowsFor(state.leagueRows) },
    provider_sync_state: state.failTables.has('provider_sync_state')
      ? { error: { code: 'PGRST301', message: FORBIDDEN.errorMessage } }
      : { data: state.syncRow ? [state.syncRow] : [] },
  };
}

/**
 * Resolves each fixture lazily, at await time, so a read issued after the
 * refresh sees the state the refresh left behind rather than a snapshot taken
 * when the fake was built.
 */
function fakeSupabase(state: SavedState, events: string[]) {
  const selectCalls: SelectCall[] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string, options?: unknown) {
          selectCalls.push({ table, columns, options });
          events.push(`select:${table}`);
          const builder: Record<string, unknown> = {
            eq: () => builder,
            is: () => builder,
            gt: () => builder,
            limit: () => builder,
            then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
              const fixture = fixturesFor(state)[table] ?? {};
              const data = fixture.data ?? [];
              return Promise.resolve({
                data: fixture.error ? null : data,
                count: fixture.error ? null : fixture.count ?? data.length,
                error: fixture.error ?? null,
              }).then(resolve, reject);
            },
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

// ---------------------------------------------------------------------------
// Provider results
// ---------------------------------------------------------------------------

/** A successful Yahoo leg whose details also carry raw customer payload. */
function successProviderResult(count = 3): ProviderRefreshResult {
  return {
    platform: 'yahoo',
    status: 'success',
    httpStatus: 200,
    details: {
      count,
      leagues: [
        { league_key: FORBIDDEN.leagueKey, name: FORBIDDEN.leagueName, team_name: FORBIDDEN.teamName },
      ],
      access_token: FORBIDDEN.accessToken,
    },
  };
}

/** A failed Yahoo leg carrying an upstream body, a token and a league key. */
function errorProviderResult(): ProviderRefreshResult {
  return {
    platform: 'yahoo',
    status: 'error',
    httpStatus: 502,
    error: 'yahoo_api_error',
    error_description: `Yahoo responded 500: ${FORBIDDEN.upstreamBody}`,
    retryAfter: '45',
    details: {
      upstream_status: 500,
      count: 0,
      body_snippet: FORBIDDEN.upstreamBody,
      access_token: FORBIDDEN.accessToken,
      refresh_token: FORBIDDEN.refreshToken,
    },
  };
}

function refreshResponse(yahoo: ProviderRefreshResult | null): LeagueRefreshResponse {
  return {
    success: yahoo?.status === 'success',
    requestedPlatforms: ['yahoo'],
    results: yahoo ? { yahoo } : {},
  };
}

/**
 * The injected refresh. Records when it starts and finishes and, on success,
 * applies the persistence a real refresh would have: a read that ran alongside
 * it, rather than strictly after it, would see the old row count.
 */
function fakeRefresh(
  state: SavedState,
  events: string[],
  response: LeagueRefreshResponse,
  savedRowsAfter: number | null = null
): ReturnType<typeof vi.fn> {
  return vi.fn(async (..._args: Parameters<typeof refreshLeaguesForUser>) => {
    events.push('refresh:start');
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (savedRowsAfter !== null) {
      state.leagueRows = savedRowsAfter;
      state.syncRow = { ...(state.syncRow ?? {}), last_league_count: savedRowsAfter, provider: 'yahoo' };
    }
    events.push('refresh:end');
    return response;
  });
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
  // Nothing in this module may reach the network directly; only the injected
  // refresh is allowed to, and here it is a stub.
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
  options: {
    state?: SavedState;
    response?: LeagueRefreshResponse;
    savedRowsAfter?: number | null;
  } = {}
) {
  const state = options.state ?? savedState();
  const events: string[] = [];
  const supabase = fakeSupabase(state, events);
  const refresh = fakeRefresh(
    state,
    events,
    options.response ?? refreshResponse(successProviderResult()),
    options.savedRowsAfter ?? null
  );
  return {
    state,
    events,
    supabase,
    refresh,
    result: runYahooSupportRefresh(
      env,
      { userId: USER_ID },
      { now: () => NOW_MS, supabase: supabase.client, refresh: refresh as unknown as typeof refreshLeaguesForUser }
    ),
  };
}

describe('runYahooSupportRefresh', () => {
  it('runs the ordinary guarded refresh exactly once, with a scheduled sync\'s arguments', async () => {
    const { refresh, result } = run();
    await result;

    expect(refresh).toHaveBeenCalledTimes(1);
    const [passedEnv, userId, platforms, corsHeaders, correlationId, syncSource] = refresh.mock.calls[0];
    expect(passedEnv).toBe(env);
    expect(userId).toBe(USER_ID);
    expect(platforms).toEqual(['yahoo']);
    expect(corsHeaders).toEqual({});
    expect(String(correlationId)).toMatch(UUID_PATTERN);
    expect(syncSource).toBe('scheduled');
  });

  it('reports the saved state either side of the refresh', async () => {
    const { result } = run({ savedRowsAfter: 4 });
    const report = await result;

    expect(report).toEqual({
      outcome: 'ok',
      userMasked: MASKED_USER_ID,
      correlationId: expect.stringMatching(UUID_PATTERN),
      before: {
        leagueRows: 0,
        sync: {
          provider: 'yahoo',
          lastAttemptAt: '2026-09-09T03:13:44.854Z',
          lastSuccessAt: '2026-09-09T03:13:45.784Z',
          lastFailureAt: '2026-09-05T20:10:28.099Z',
          lastErrorCode: null,
          lastLeagueCount: 0,
          lastDurationMs: 733,
          lastSyncSource: 'web',
          syncLeaseExpiresAt: null,
        },
      },
      provider: { status: 'success', httpStatus: 200, leagueCount: 3, stopReason: null },
      after: {
        leagueRows: 4,
        sync: {
          provider: 'yahoo',
          lastAttemptAt: '2026-09-09T03:13:44.854Z',
          lastSuccessAt: '2026-09-09T03:13:45.784Z',
          lastFailureAt: '2026-09-05T20:10:28.099Z',
          lastErrorCode: null,
          lastLeagueCount: 4,
          lastDurationMs: 733,
          lastSyncSource: 'web',
          syncLeaseExpiresAt: null,
        },
      },
    });
  });

  it('reports the same correlation id it passed to the refresh', async () => {
    const { refresh, result } = run();
    const report = await result;

    expect(report.outcome).toBe('ok');
    expect((report as { correlationId: string }).correlationId).toBe(refresh.mock.calls[0][4]);
  });

  it('reports a null sync snapshot when the account has never attempted a sync', async () => {
    const { result } = run({ state: savedState({ syncRow: null }) });
    const report = await result;

    expect(report).toMatchObject({ outcome: 'ok', before: { sync: null }, after: { sync: null } });
  });

  // The ordering that makes the report mean anything: an "after" read that
  // raced the refresh's own persistence would report a half-written state.
  it('reads the after snapshot strictly after the refresh resolves', async () => {
    const { events, result } = run({ savedRowsAfter: 4 });
    await result;

    expect(events).toEqual([
      'select:yahoo_leagues',
      'select:provider_sync_state',
      'refresh:start',
      'refresh:end',
      'select:yahoo_leagues',
      'select:provider_sync_state',
    ]);
  });

  it('maps a missing Yahoo result to refresh_result_missing and reads no after snapshot', async () => {
    const { events, supabase, result } = run({ response: refreshResponse(null) });
    const report = await result;

    expect(report).toEqual({
      outcome: 'failed',
      userMasked: MASKED_USER_ID,
      error: 'refresh_result_missing',
    });
    // Exactly the two reads of the "before" snapshot, none after.
    expect(supabase.selectCalls).toHaveLength(2);
    expect(events).toEqual([
      'select:yahoo_leagues',
      'select:provider_sync_state',
      'refresh:start',
      'refresh:end',
    ]);
  });

  it.each(['yahoo_leagues', 'provider_sync_state'])(
    'returns snapshot_failed and never refreshes when the before read of %s fails',
    async (table) => {
      const { refresh, result } = run({ state: savedState({ failTables: new Set([table]) }) });
      const report = await result;

      expect(report).toEqual({
        outcome: 'failed',
        userMasked: MASKED_USER_ID,
        error: 'snapshot_failed',
      });
      expect(refresh).not.toHaveBeenCalled();
    }
  );

  it('returns snapshot_failed when the after read fails, having already refreshed', async () => {
    const state = savedState();
    const events: string[] = [];
    const supabase = fakeSupabase(state, events);
    const refresh = vi.fn(async () => {
      // The refresh succeeded; the database went away afterwards.
      state.failTables.add('yahoo_leagues');
      return refreshResponse(successProviderResult());
    });

    const report = await runYahooSupportRefresh(
      env,
      { userId: USER_ID },
      { now: () => NOW_MS, supabase: supabase.client, refresh: refresh as unknown as typeof refreshLeaguesForUser }
    );

    expect(report).toEqual({
      outcome: 'failed',
      userMasked: MASKED_USER_ID,
      error: 'snapshot_failed',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // Cross-model review caught this: unlike inspect/diagnose, a throw from the
  // refresh call itself was not wrapped, so it would skip the audit log below
  // and reach the caller as a bare unhandled 500 rather than this module's
  // stable failure shape.
  it('collapses a thrown error from the guarded refresh call to a stable refresh_failed shape', async () => {
    const state = savedState();
    const events: string[] = [];
    const supabase = fakeSupabase(state, events);
    const refresh = vi.fn(async () => {
      throw new Error('upstream said: league_key nfl.l.999999 already exists');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const report = await runYahooSupportRefresh(
      env,
      { userId: USER_ID },
      { now: () => NOW_MS, supabase: supabase.client, refresh: refresh as unknown as typeof refreshLeaguesForUser }
    );

    expect(report).toEqual({
      outcome: 'failed',
      userMasked: MASKED_USER_ID,
      error: 'refresh_failed',
    });
    // The audit log still fires — a thrown error must not silently skip it.
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toMatchObject({
      event: 'yahoo_support_refresh',
      outcome: 'failed',
    });
    // Name only: the thrown message (which here quotes a league key) must
    // never reach any log call.
    const allLoggedText = [...errorSpy.mock.calls, ...logSpy.mock.calls].flat().join(' ');
    expect(allLoggedText).not.toContain('nfl.l.999999');
    expect(allLoggedText).not.toContain('league_key');

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('names every column it reads and never selects an identifier or a token', async () => {
    const { supabase, result } = run({ savedRowsAfter: 2 });
    await result;

    const forbiddenColumns = ['*', 'access_token', 'refresh_token', 'league_key', 'league_name', 'team_name',
      'team_key', 'sync_lease_owner', 'last_error_message'];

    for (const table of ['yahoo_leagues', 'provider_sync_state']) {
      const columns = supabase.columnsFor(table);
      expect(columns.length).toBeGreaterThan(0);
      for (const selected of columns) {
        for (const forbidden of forbiddenColumns) {
          expect(selected).not.toContain(forbidden);
        }
      }
    }

    expect(supabase.columnsFor('yahoo_leagues')).toEqual(['season_year', 'season_year']);
  });

  it('sanitizes a failed provider result down to codes, statuses and counts', async () => {
    const { result } = run({ response: refreshResponse(errorProviderResult()) });
    const report = await result;

    expect(report).toMatchObject({
      outcome: 'ok',
      provider: {
        status: 'error',
        httpStatus: 502,
        error: 'yahoo_api_error',
        retryAfterSeconds: 45,
        upstreamStatus: 500,
        leagueCount: 0,
        stopReason: null,
      },
    });
    // Nothing free-form survives the projection.
    const provider = (report as unknown as { provider: Record<string, unknown> }).provider;
    expect(Object.keys(provider).sort()).toEqual([
      'error', 'httpStatus', 'leagueCount', 'retryAfterSeconds', 'status', 'stopReason', 'upstreamStatus',
    ]);
    expect(provider).not.toHaveProperty('error_description');
    expect(provider).not.toHaveProperty('details');
  });

  it('flags a Yahoo rate limit as a stop reason', async () => {
    const rateLimited: ProviderRefreshResult = {
      platform: 'yahoo',
      status: 'error',
      error: 'yahoo_rate_limited',
      details: { upstream_status: 999 },
    };
    const { result } = run({ response: refreshResponse(rateLimited) });
    const report = await result;

    expect(report).toMatchObject({ outcome: 'ok', provider: { stopReason: 'rate_limited' } });
  });

  it('leaks no upstream body, token or customer identifier into the report', async () => {
    const { result } = run({ response: refreshResponse(errorProviderResult()), savedRowsAfter: 2 });
    const report = await result;

    const strings = deepStrings(report);
    for (const forbidden of Object.values(FORBIDDEN)) {
      for (const value of strings) {
        expect(value).not.toContain(forbidden);
      }
    }
    for (const key of ['league_key', 'league_name', 'team_name', 'team_key', 'access_token', 'refresh_token',
      'sync_lease_owner', 'last_error_message', 'body_snippet', 'error_description', 'details']) {
      expect(strings).not.toContain(key);
    }
    expect(JSON.stringify(report)).not.toContain(USER_ID);
  });

  it('writes one audit line that masks the user id and carries no customer data', async () => {
    const { result } = run({ response: refreshResponse(successProviderResult()), savedRowsAfter: 3 });
    await result;

    const auditLines = logSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('yahoo_support_refresh'));
    expect(auditLines).toHaveLength(1);

    const audit = JSON.parse(auditLines[0]) as Record<string, unknown>;
    expect(audit).toMatchObject({
      event: 'yahoo_support_refresh',
      service: 'auth-worker',
      user_id: MASKED_USER_ID,
      outcome: 'ok',
      status: 'success',
      league_count: 3,
    });
    expect(String(audit.correlation_id)).toMatch(UUID_PATTERN);

    expect(auditLines[0]).not.toContain(USER_ID);
    for (const forbidden of Object.values(FORBIDDEN)) {
      expect(auditLines[0]).not.toContain(forbidden);
    }
  });

  it('still writes an audit line when the refresh produced no Yahoo result', async () => {
    const { result } = run({ response: refreshResponse(null) });
    await result;

    const audit = JSON.parse(
      logSpy.mock.calls.map((call) => String(call[0])).find((line) => line.includes('yahoo_support_refresh')) ?? '{}'
    ) as Record<string, unknown>;

    expect(audit).toMatchObject({ outcome: 'failed', status: null, league_count: null });
  });

  it('makes no outbound request of its own', async () => {
    await run().result;

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
