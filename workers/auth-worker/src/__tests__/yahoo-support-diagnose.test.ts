import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Diagnose (FLA-360): the one support action that reaches Yahoo.
 *
 * Two halves. The first drives `diagnoseYahooDiscovery` through mocked storage
 * and a mocked `fetch`, pinning the guarded-renewal path, the hard request
 * budget, and the write-path non-goals. The second drives
 * `runYahooSupportDiagnose` with an injected diagnosis, so every interpretation
 * category is asserted against an exact, hand-built diagnosis shape.
 *
 * Entirely offline: the only `fetch` is the mock, and it distinguishes Yahoo's
 * token endpoint from Yahoo's fantasy API so "zero Yahoo resource calls" is a
 * real assertion rather than a hopeful one.
 */

// Write-path doubles. Diagnose is read-only against Flaim state; these spies
// turn that from a comment into an assertion.
const writeSpies = vi.hoisted(() => ({
  syncStateConstructed: vi.fn(),
  settle: vi.fn(),
  acquireLease: vi.fn(),
  refreshLeaguesForUser: vi.fn(),
}));

vi.mock('../yahoo-storage', async () => {
  const actual = await vi.importActual<typeof import('../yahoo-storage')>('../yahoo-storage');
  return { ...actual, YahooStorage: { ...actual.YahooStorage, fromEnvironment: vi.fn() } };
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

vi.mock('../league-refresh', async () => {
  const actual = await vi.importActual<typeof import('../league-refresh')>('../league-refresh');
  return { ...actual, refreshLeaguesForUser: writeSpies.refreshLeaguesForUser };
});

import {
  diagnoseYahooDiscovery,
  createYahooParseStats,
  type YahooConnectEnv,
  type YahooDiagnosticCall,
  type YahooParseStats,
  type YahooSupportDiagnosis,
} from '../yahoo-connect-handlers';
import {
  MAX_YAHOO_DIAGNOSTIC_REQUESTS,
  runYahooSupportDiagnose,
  type DiagnoseInterpretation,
  type YahooSupportEnv,
} from '../yahoo-support-diagnostics';
import { REFRESH_COOLDOWN_OWNER_PREFIX, YahooStorage } from '../yahoo-storage';

const USER_ID = 'user_3Ie4m68lUbzxyv22NsMU';
const MASKED_USER_ID = 'user_3Ie...';
const NOW_MS = Date.parse('2026-09-09T15:00:00.000Z');
const CHECKED_AT = '2026-09-09T15:00:00.000Z';

const DISCOVERY_URL =
  'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_types=full/leagues;out=teams?format=json';
const YAHOO_FANTASY_HOST = 'https://fantasysports.yahooapis.com';
const YAHOO_TOKEN_HOST = 'https://api.login.yahoo.com';

const env: YahooConnectEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  YAHOO_CLIENT_ID: 'test-yahoo-client-id',
  YAHOO_CLIENT_SECRET: 'test-yahoo-client-secret',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
};

const supportEnv = env as unknown as YahooSupportEnv;

/** Customer-shaped strings that must never reach a report or a log line. */
const FORBIDDEN = {
  leagueKey: '449.l.987654',
  leagueName: 'Sentinel Dynasty League',
  teamKey: '449.l.987654.t.7',
  teamName: 'Sentinel Sunday Squad',
  accessToken: 'ya29-sentinel-access-token',
  refreshToken: 'sentinel-refresh-token',
} as const;

// ---------------------------------------------------------------------------
// Yahoo payload builders
// ---------------------------------------------------------------------------

function discoveryPayload(games: unknown): unknown {
  return { fantasy_content: { users: { count: 1, 0: { user: [{ guid: 'guid-1' }, { games }] } } } };
}

/** One NFL game holding one real, fully-identified league. */
function payloadWithOneLeague(): unknown {
  return discoveryPayload({
    count: 1,
    0: {
      game: [
        { code: 'nfl', season: '2026', game_type: 'full' },
        {
          leagues: {
            count: 1,
            0: {
              league: [
                { league_key: FORBIDDEN.leagueKey, name: FORBIDDEN.leagueName, renew: '' },
                {
                  teams: {
                    count: 1,
                    0: { team: [[{ team_key: FORBIDDEN.teamKey }, { team_id: '7' }, { name: FORBIDDEN.teamName }]] },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  });
}

/** A valid envelope reporting no games at all — the ambiguous case. */
function payloadWithNoGames(): unknown {
  return discoveryPayload({ count: 0 });
}

// ---------------------------------------------------------------------------
// fetch routing
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let mockStorage: {
  getYahooCredentials: ReturnType<typeof vi.fn>;
  updateYahooCredentials: ReturnType<typeof vi.fn>;
  updateYahooCredentialsIfRefreshTokenMatches: ReturnType<typeof vi.fn>;
  markRefreshCooldown: ReturnType<typeof vi.fn>;
  acquireRefreshLease: ReturnType<typeof vi.fn>;
  releaseRefreshLease: ReturnType<typeof vi.fn>;
  upsertYahooLeague: ReturnType<typeof vi.fn>;
  deleteAllYahooLeagues: ReturnType<typeof vi.fn>;
  getYahooLeagues: ReturnType<typeof vi.fn>;
};

function fetchedUrls(): string[] {
  return mockFetch.mock.calls.map((call) => String(call[0]));
}

function fantasyApiCalls(): string[] {
  return fetchedUrls().filter((url) => url.startsWith(YAHOO_FANTASY_HOST));
}

function tokenEndpointCalls(): string[] {
  return fetchedUrls().filter((url) => url.startsWith(YAHOO_TOKEN_HOST));
}

/** Route responses by URL so a test never has to care about call ordering. */
function routeFetch(routes: {
  token?: () => Response;
  discovery?: () => Response;
  fallback?: () => Response;
}) {
  mockFetch.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith(YAHOO_TOKEN_HOST)) {
      return routes.token?.() ?? new Response('{}', { status: 500 });
    }
    if (url === DISCOVERY_URL) {
      return routes.discovery?.() ?? new Response('{}', { status: 500 });
    }
    if (url.startsWith(YAHOO_FANTASY_HOST)) {
      return routes.fallback?.() ?? new Response('{}', { status: 500 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function freshCredentials(overrides: Record<string, unknown> = {}) {
  return {
    clerkUserId: USER_ID,
    accessToken: FORBIDDEN.accessToken,
    refreshToken: FORBIDDEN.refreshToken,
    expiresAt: new Date(NOW_MS + 60 * 60 * 1000),
    updatedAt: new Date(NOW_MS - 60 * 1000),
    needsRefresh: false,
    ...overrides,
  };
}

function staleCredentials(overrides: Record<string, unknown> = {}) {
  return freshCredentials({
    expiresAt: new Date(NOW_MS - 60 * 1000),
    needsRefresh: true,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  mockStorage = {
    getYahooCredentials: vi.fn().mockResolvedValue(freshCredentials()),
    updateYahooCredentials: vi.fn().mockResolvedValue(true),
    updateYahooCredentialsIfRefreshTokenMatches: vi.fn().mockResolvedValue(false),
    markRefreshCooldown: vi.fn().mockResolvedValue(true),
    acquireRefreshLease: vi.fn().mockResolvedValue(true),
    releaseRefreshLease: vi.fn().mockResolvedValue(undefined),
    upsertYahooLeague: vi.fn().mockResolvedValue('league-id'),
    deleteAllYahooLeagues: vi.fn().mockResolvedValue(undefined),
    getYahooLeagues: vi.fn().mockResolvedValue([]),
  };
  vi.mocked(YahooStorage.fromEnvironment).mockReturnValue(mockStorage as unknown as YahooStorage);

  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
  routeFetch({ discovery: () => json(payloadWithOneLeague()) });

  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The structured yahoo-connect diagnostics emitted during a run. */
function yahooConnectDiagnostics(): Array<Record<string, unknown>> {
  return logSpy.mock.calls
    .map((call) => String(call[0]))
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry?.component === 'yahoo-connect');
}

// ===========================================================================
// diagnoseYahooDiscovery — renewal, budget, and the write-path non-goals
// ===========================================================================

describe('diagnoseYahooDiscovery', () => {
  it('reports not_connected and touches Yahoo not at all when there is no credential row', async () => {
    mockStorage.getYahooCredentials.mockResolvedValue(null);

    const diagnosis = await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

    expect(diagnosis).toEqual({ stage: 'not_connected' });
    expect(mockStorage.getYahooCredentials).toHaveBeenCalledWith(USER_ID);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('runs the guarded token path for the target user even when the token is fresh', async () => {
    const diagnosis = await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

    // The guarded path short-circuits on a fresh token, and says so — proof it
    // was entered rather than skipped by a needsRefresh check in the caller.
    const events = yahooConnectDiagnostics();
    expect(events.map((entry) => entry.event)).toContain('token_fresh_returned');
    expect(events.every((entry) => entry.user_id === undefined || entry.user_id === MASKED_USER_ID)).toBe(true);
    expect(tokenEndpointCalls()).toHaveLength(0);

    // ...and the fresh stored token is the one presented to Yahoo.
    const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FORBIDDEN.accessToken}`);
    expect(diagnosis.stage).toBe('completed');
  });

  it('renews an expired token through the lease and uses the renewed token', async () => {
    mockStorage.getYahooCredentials.mockResolvedValue(staleCredentials());
    routeFetch({
      token: () => json({ access_token: 'renewed-token', refresh_token: 'renewed-refresh', expires_in: 3600, token_type: 'bearer' }),
      discovery: () => json(payloadWithOneLeague()),
    });

    const diagnosis = await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

    expect(mockStorage.acquireRefreshLease).toHaveBeenCalledTimes(1);
    expect(tokenEndpointCalls()).toHaveLength(1);
    const discoveryCall = mockFetch.mock.calls.find(([url]) => String(url) === DISCOVERY_URL);
    expect((discoveryCall?.[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer renewed-token' });
    expect(diagnosis.stage).toBe('completed');
  });

  describe('stops at credential_refresh_failed, with zero Yahoo resource calls', () => {
    it('for a cooldown', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue(
        staleCredentials({
          refreshLeaseOwner: `${REFRESH_COOLDOWN_OWNER_PREFIX}abc`,
          refreshLeaseExpiresAt: new Date(Date.now() + 45_000),
        })
      );

      const diagnosis = await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

      expect(diagnosis).toMatchObject({
        stage: 'credential_refresh_failed',
        errorCode: 'refresh_temporarily_unavailable',
        retryable: true,
        appFingerprintMismatch: false,
      });
      expect(diagnosis).toHaveProperty('retryAfterSeconds');
      expect(fantasyApiCalls()).toHaveLength(0);
      expect(mockStorage.acquireRefreshLease).not.toHaveBeenCalled();
    });

    it('for an app-fingerprint mismatch', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue(
        staleCredentials({ appFingerprint: 'ffffffffffff' })
      );

      const diagnosis = await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

      expect(diagnosis).toMatchObject({
        stage: 'credential_refresh_failed',
        errorCode: 'app_fingerprint_mismatch',
        appFingerprintMismatch: true,
      });
      // The pre-check refuses to call Yahoo at all — token endpoint included.
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockStorage.acquireRefreshLease).not.toHaveBeenCalled();
    });

    it('for a permanent rejection of the stored grant', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue(staleCredentials());
      routeFetch({
        token: () => json({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, 400),
      });

      const diagnosis = await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

      expect(diagnosis).toMatchObject({
        stage: 'credential_refresh_failed',
        errorCode: 'refresh_failed',
        upstreamStatus: 400,
        appFingerprintMismatch: false,
      });
      expect(diagnosis).not.toHaveProperty('retryable');
      expect(fantasyApiCalls()).toHaveLength(0);
    });
  });

  describe('request budget', () => {
    it('makes exactly one Yahoo call when the first finds a league', async () => {
      const diagnosis = await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

      expect(diagnosis).toMatchObject({ stage: 'completed', requestCount: 1 });
      expect(fantasyApiCalls()).toEqual([DISCOVERY_URL]);
    });

    it('makes exactly two when the first finds none on a valid envelope', async () => {
      routeFetch({
        discovery: () => json(payloadWithNoGames()),
        fallback: () => json(payloadWithOneLeague()),
      });

      const diagnosis = await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

      expect(diagnosis).toMatchObject({ stage: 'completed', requestCount: 2 });
      const calls = fantasyApiCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0]).toBe(DISCOVERY_URL);
      // The fallback drops the game_types filter and names one sport and season.
      expect(calls[1]).toContain('game_codes=nfl');
      expect(calls[1]).toContain('seasons=');
      expect(calls[1]).not.toContain('game_types=full');
    });

    it('never exceeds the shared budget, even when the fallback is also empty', async () => {
      routeFetch({
        discovery: () => json(payloadWithNoGames()),
        fallback: () => json(payloadWithNoGames()),
      });

      const diagnosis = await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

      expect(diagnosis).toMatchObject({ stage: 'completed', requestCount: 2 });
      expect(fantasyApiCalls().length).toBeLessThanOrEqual(MAX_YAHOO_DIAGNOSTIC_REQUESTS);
    });

    it.each([
      ['a non-200 status', () => json({ error: { description: 'nope' } }, 500)],
      ['a non-JSON body', () => new Response('<!DOCTYPE html><html>oops</html>', { status: 200 })],
      ['JSON without a fantasy_content envelope', () => json({ error: { description: 'nope' } }, 200)],
      ['an empty body', () => new Response('', { status: 200 })],
    ])('makes no fallback call for %s', async (_label, discovery) => {
      routeFetch({ discovery });

      const diagnosis = await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

      expect(diagnosis).toMatchObject({ stage: 'completed', requestCount: 1 });
      expect(fantasyApiCalls()).toEqual([DISCOVERY_URL]);
    });

    it('records a transport failure as one call with no status', async () => {
      routeFetch({
        discovery: () => {
          throw new Error('network down');
        },
      });

      const diagnosis = await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

      expect(diagnosis.stage).toBe('completed');
      const [call] = (diagnosis as Extract<YahooSupportDiagnosis, { stage: 'completed' }>).calls;
      expect(call).toMatchObject({ httpStatus: null, ok: false, stats: null, parsedLeagueCount: null });
    });
  });

  describe('call classification', () => {
    it.each<[string, () => Response, YahooDiagnosticCall['errorSnippetCategory']]>([
      ['an empty body', () => new Response('', { status: 200 }), 'empty'],
      ['an HTML error page', () => new Response('<!DOCTYPE html><html>Yahoo</html>', { status: 503 }), 'html'],
      ['a Yahoo JSON error envelope', () => json({ error: { description: 'denied' } }, 403), 'yahoo_error_json'],
      ['an unparseable body', () => new Response('not json at all', { status: 200 }), 'unparseable'],
      ['the expected envelope', () => json(payloadWithNoGames()), 'none'],
    ])('categorizes %s', async (_label, discovery, expected) => {
      routeFetch({ discovery, fallback: () => json(payloadWithNoGames()) });

      const diagnosis = (await diagnoseYahooDiscovery(env, USER_ID, 'corr-1')) as Extract<
        YahooSupportDiagnosis,
        { stage: 'completed' }
      >;

      expect(diagnosis.calls[0].errorSnippetCategory).toBe(expected);
    });

    it('attaches parser stats and a league count on a parseable envelope', async () => {
      const diagnosis = (await diagnoseYahooDiscovery(env, USER_ID, 'corr-1')) as Extract<
        YahooSupportDiagnosis,
        { stage: 'completed' }
      >;
      const call = diagnosis.calls[0];

      expect(call).toMatchObject({
        label: 'full_games',
        url: DISCOVERY_URL,
        httpStatus: 200,
        ok: true,
        bodyIsJson: true,
        bodyLooksLikeEnvelope: true,
        parsedLeagueCount: 1,
      });
      expect(call.stats).toMatchObject({ envelope: 'valid', accepted: 1 });
      expect(typeof call.durationMs).toBe('number');
    });

    it('never lets a customer identifier out of the parse', async () => {
      const diagnosis = await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');
      const serialized = JSON.stringify(diagnosis);

      for (const forbidden of Object.values(FORBIDDEN)) {
        expect(serialized).not.toContain(forbidden);
      }
    });
  });

  describe('write-path non-goals', () => {
    it('persists nothing on the success path', async () => {
      await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

      expect(mockStorage.upsertYahooLeague).not.toHaveBeenCalled();
      expect(mockStorage.deleteAllYahooLeagues).not.toHaveBeenCalled();
      expect(writeSpies.syncStateConstructed).not.toHaveBeenCalled();
      expect(writeSpies.settle).not.toHaveBeenCalled();
      expect(writeSpies.acquireLease).not.toHaveBeenCalled();
      expect(writeSpies.refreshLeaguesForUser).not.toHaveBeenCalled();
      // handleYahooDiscover is the only other code path that fetches this URL,
      // and it always persists through upsertYahooLeague. One fetch and zero
      // upserts is proof it did not run.
      expect(fantasyApiCalls()).toEqual([DISCOVERY_URL]);
    });

    it.each([
      ['not connected', () => mockStorage.getYahooCredentials.mockResolvedValue(null)],
      ['renewal rejected', () => {
        mockStorage.getYahooCredentials.mockResolvedValue(staleCredentials({ appFingerprint: 'ffffffffffff' }));
      }],
      ['a malformed payload', () => routeFetch({ discovery: () => new Response('nope', { status: 500 }) })],
      ['an empty account', () => routeFetch({
        discovery: () => json(payloadWithNoGames()),
        fallback: () => json(payloadWithNoGames()),
      })],
    ])('persists nothing when the outcome is %s', async (_label, arrange) => {
      arrange();

      await diagnoseYahooDiscovery(env, USER_ID, 'corr-1');

      expect(mockStorage.upsertYahooLeague).not.toHaveBeenCalled();
      expect(mockStorage.deleteAllYahooLeagues).not.toHaveBeenCalled();
      expect(writeSpies.syncStateConstructed).not.toHaveBeenCalled();
      expect(writeSpies.settle).not.toHaveBeenCalled();
      expect(writeSpies.acquireLease).not.toHaveBeenCalled();
      expect(writeSpies.refreshLeaguesForUser).not.toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// runYahooSupportDiagnose — report envelope, interpretation, audit log
// ===========================================================================

function statsWith(overrides: Partial<YahooParseStats> = {}): YahooParseStats {
  return { ...createYahooParseStats(), envelope: 'valid', ...overrides };
}

function completedCall(overrides: Partial<YahooDiagnosticCall> = {}): YahooDiagnosticCall {
  return {
    label: 'full_games',
    url: DISCOVERY_URL,
    httpStatus: 200,
    ok: true,
    bodyIsJson: true,
    bodyLooksLikeEnvelope: true,
    errorSnippetCategory: 'none',
    stats: statsWith(),
    parsedLeagueCount: 0,
    durationMs: 42,
    ...overrides,
  };
}

function completed(calls: YahooDiagnosticCall[]): YahooSupportDiagnosis {
  return { stage: 'completed', calls, requestCount: calls.length };
}

function runWith(diagnosis: YahooSupportDiagnosis) {
  const diagnose = vi.fn().mockResolvedValue(diagnosis);
  return {
    diagnose,
    result: runYahooSupportDiagnose(supportEnv, { userId: USER_ID }, { now: () => NOW_MS, diagnose }),
  };
}

async function categoryOf(diagnosis: YahooSupportDiagnosis): Promise<DiagnoseInterpretation> {
  const report = await runWith(diagnosis).result;
  if (report.outcome !== 'ok') throw new Error('expected an ok report');
  return report.interpretation;
}

describe('runYahooSupportDiagnose', () => {
  it('wraps the diagnosis in a stable report envelope', async () => {
    const diagnosis = completed([completedCall({ parsedLeagueCount: 3, stats: statsWith({ accepted: 3 }) })]);
    const { diagnose, result } = runWith(diagnosis);
    const report = await result;

    expect(diagnose).toHaveBeenCalledTimes(1);
    expect(diagnose).toHaveBeenCalledWith(supportEnv, USER_ID, expect.any(String));
    expect(report).toMatchObject({
      outcome: 'ok',
      userMasked: MASKED_USER_ID,
      checkedAt: CHECKED_AT,
      diagnosis,
    });
    if (report.outcome !== 'ok') throw new Error('expected an ok report');
    expect(report.correlationId).toEqual(expect.any(String));
    // The same correlation id is handed to the probe and returned to the caller.
    expect(diagnose.mock.calls[0][2]).toBe(report.correlationId);
  });

  it('collapses a thrown error into diagnostic_failed without leaking its message', async () => {
    const diagnose = vi.fn().mockRejectedValue(new Error(`storage exploded on ${FORBIDDEN.leagueKey}`));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const report = await runYahooSupportDiagnose(supportEnv, { userId: USER_ID }, { now: () => NOW_MS, diagnose });

    expect(report).toEqual({ outcome: 'failed', userMasked: MASKED_USER_ID, error: 'diagnostic_failed' });
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain(FORBIDDEN.leagueKey);
    expect(logged).toContain('Error');
  });

  describe('interpretation', () => {
    it('classifies a missing connection', async () => {
      const interpretation = await categoryOf({ stage: 'not_connected' });

      expect(interpretation.category).toBe('not_connected');
      expect(interpretation.nextAction).toMatch(/connect/i);
    });

    it('classifies an app-fingerprint mismatch distinctly', async () => {
      const interpretation = await categoryOf({
        stage: 'credential_refresh_failed',
        errorCode: 'app_fingerprint_mismatch',
        appFingerprintMismatch: true,
      });

      expect(interpretation.category).toBe('credential_renewal_rejected');
      expect(interpretation.summary).toMatch(/different Yahoo app/i);
      expect(interpretation.nextAction).toMatch(/reconnect/i);
    });

    it('classifies a retryable cooldown distinctly, naming the wait', async () => {
      const interpretation = await categoryOf({
        stage: 'credential_refresh_failed',
        errorCode: 'refresh_temporarily_unavailable',
        retryable: true,
        retryAfterSeconds: 45,
        appFingerprintMismatch: false,
      });

      expect(interpretation.category).toBe('credential_renewal_rejected');
      expect(interpretation.summary).toMatch(/temporarily unavailable/i);
      expect(interpretation.nextAction).toContain('45 seconds');
    });

    it('classifies a permanently revoked grant distinctly', async () => {
      const interpretation = await categoryOf({
        stage: 'credential_refresh_failed',
        errorCode: 'refresh_failed',
        upstreamStatus: 400,
        appFingerprintMismatch: false,
      });

      expect(interpretation.category).toBe('credential_renewal_rejected');
      expect(interpretation.summary).toMatch(/rejected the stored credential/i);
      expect(interpretation.summary).toContain('400');
      expect(interpretation.nextAction).toMatch(/reconnect/i);
    });

    it('gives the three renewal failures three different sentences', async () => {
      const summaries = await Promise.all([
        categoryOf({ stage: 'credential_refresh_failed', errorCode: 'app_fingerprint_mismatch', appFingerprintMismatch: true }),
        categoryOf({ stage: 'credential_refresh_failed', errorCode: 'refresh_temporarily_unavailable', retryable: true, retryAfterSeconds: 30, appFingerprintMismatch: false }),
        categoryOf({ stage: 'credential_refresh_failed', errorCode: 'refresh_failed', upstreamStatus: 400, appFingerprintMismatch: false }),
      ]);

      expect(new Set(summaries.map((entry) => entry.summary)).size).toBe(3);
      expect(new Set(summaries.map((entry) => entry.nextAction)).size).toBe(3);
    });

    it('classifies reachable data and points at refresh', async () => {
      const interpretation = await categoryOf(
        completed([completedCall({ parsedLeagueCount: 4, stats: statsWith({ accepted: 4, declared: { users: 1, games: 2, leagues: 4 } }) })])
      );

      expect(interpretation.category).toBe('data_reachable');
      expect(interpretation.nextAction).toContain('refresh --confirm');
    });

    it('classifies the discovery filter excluding a real account', async () => {
      const interpretation = await categoryOf(
        completed([
          completedCall({ stats: statsWith({ accepted: 0, declared: { users: 1, games: 0, leagues: 0 } }) }),
          completedCall({
            label: 'football_current_season',
            url: 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_codes=nfl;seasons=2026/leagues;out=teams?format=json',
            parsedLeagueCount: 2,
            stats: statsWith({ accepted: 2, declared: { users: 1, games: 1, leagues: 2 } }),
          }),
        ])
      );

      expect(interpretation.category).toBe('filter_excludes_account');
      expect(interpretation.summary).toContain('game_types=full');
      expect(interpretation.nextAction).toMatch(/file a new bug/i);
    });

    it('classifies a genuinely empty account when the fallback is empty too', async () => {
      const interpretation = await categoryOf(
        completed([
          completedCall({ stats: statsWith({ accepted: 0, declared: { users: 1, games: 0, leagues: 0 } }) }),
          completedCall({
            label: 'football_current_season',
            stats: statsWith({ accepted: 0, declared: { users: 1, games: 0, leagues: 0 } }),
          }),
        ])
      );

      expect(interpretation.category).toBe('genuinely_empty_account');
    });

    it('classifies a genuinely empty account when the fallback itself failed', async () => {
      const interpretation = await categoryOf(
        completed([
          completedCall({ stats: statsWith({ accepted: 0, declared: { users: 1, games: 0, leagues: 0 } }) }),
          completedCall({ label: 'football_current_season', httpStatus: 500, ok: false, stats: null }),
        ])
      );

      expect(interpretation.category).toBe('genuinely_empty_account');
    });

    it('classifies a parser gap and names the unmapped game codes', async () => {
      const interpretation = await categoryOf(
        completed([
          completedCall({
            stats: statsWith({
              accepted: 0,
              declared: { users: 1, games: 2, leagues: 3 },
              indexed: { users: 1, games: 2, leagues: 3 },
              skipped: { ...createYahooParseStats().skipped, unsupportedSportCode: 2 },
              unsupportedGameCodes: ['pickem', 'nflp'],
            }),
          }),
        ])
      );

      expect(interpretation.category).toBe('parser_dropped_all');
      expect(interpretation.summary).toContain('pickem');
      expect(interpretation.summary).toContain('nflp');
    });

    it('classifies a swallowed count level', async () => {
      const interpretation = await categoryOf(
        completed([
          completedCall({
            stats: statsWith({
              accepted: 0,
              declared: { users: 1, games: 1, leagues: 0 },
              indexed: { users: 1, games: 1, leagues: 2 },
            }),
          }),
        ])
      );

      expect(interpretation.category).toBe('declared_count_zero_with_entries');
      expect(interpretation.summary).toContain('2');
    });

    it.each<[string, Partial<YahooDiagnosticCall>]>([
      ['a non-200 response', { httpStatus: 500, ok: false, stats: null, errorSnippetCategory: 'yahoo_error_json' }],
      ['a non-JSON body', { bodyIsJson: false, bodyLooksLikeEnvelope: false, stats: null, errorSnippetCategory: 'html' }],
      ['a JSON body with no envelope', { bodyLooksLikeEnvelope: false, stats: null, errorSnippetCategory: 'yahoo_error_json' }],
      ['a parser that threw', { stats: statsWith({ threw: true, thrownErrorName: 'TypeError' }) }],
    ])('classifies %s as a malformed payload', async (_label, overrides) => {
      const interpretation = await categoryOf(completed([completedCall(overrides)]));

      expect(interpretation.category).toBe('malformed_payload');
      expect(interpretation.nextAction).toMatch(/never the body/i);
    });

    it.each([429, 999])('classifies HTTP %i as throttling, ahead of the payload shape', async (status) => {
      const interpretation = await categoryOf(
        completed([completedCall({ httpStatus: status, ok: false, bodyIsJson: false, bodyLooksLikeEnvelope: false, stats: null })])
      );

      expect(interpretation.category).toBe('throttled');
      expect(interpretation.nextAction).toMatch(/never loop/i);
    });

    it('falls through to unexplained when no known signal fires', async () => {
      const interpretation = await categoryOf(
        completed([
          completedCall({
            stats: statsWith({ accepted: 0, declared: { users: 1, games: 1, leagues: 0 }, indexed: { users: 1, games: 1, leagues: 0 } }),
          }),
        ])
      );

      expect(interpretation.category).toBe('unexplained_empty_result');
    });

    it('falls through to unexplained when the probe recorded no call at all', async () => {
      const interpretation = await categoryOf({ stage: 'completed', calls: [], requestCount: 0 });

      expect(interpretation.category).toBe('unexplained_empty_result');
    });
  });

  describe('audit log', () => {
    it('writes one line that masks the user id and carries the stage and budget', async () => {
      await runWith(completed([completedCall({ parsedLeagueCount: 1, stats: statsWith({ accepted: 1 }) })])).result;

      const auditLines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('yahoo_support_diagnose'));
      expect(auditLines).toHaveLength(1);

      const audit = JSON.parse(auditLines[0]) as Record<string, unknown>;
      expect(audit).toMatchObject({
        event: 'yahoo_support_diagnose',
        service: 'auth-worker',
        user_id: MASKED_USER_ID,
        outcome: 'ok',
        stage: 'completed',
        yahoo_request_count: 1,
      });
      expect(typeof audit.correlation_id).toBe('string');
      expect(auditLines[0]).not.toContain(USER_ID);
      for (const forbidden of Object.values(FORBIDDEN)) {
        expect(auditLines[0]).not.toContain(forbidden);
      }
    });

    it('reports a null stage and a zero budget when the diagnostic failed', async () => {
      const diagnose = vi.fn().mockRejectedValue(new Error('boom'));
      await runYahooSupportDiagnose(supportEnv, { userId: USER_ID }, { now: () => NOW_MS, diagnose });

      const audit = JSON.parse(
        logSpy.mock.calls.map((call) => String(call[0])).find((line) => line.includes('yahoo_support_diagnose')) ?? '{}'
      ) as Record<string, unknown>;

      expect(audit).toMatchObject({ outcome: 'failed', stage: null, yahoo_request_count: 0 });
    });
  });

  it('carries no customer identifier anywhere in the report, end to end', async () => {
    // The full stack this time: real probe, real parser, rich Yahoo payload.
    const report = await runYahooSupportDiagnose(supportEnv, { userId: USER_ID }, { now: () => NOW_MS });

    expect(report.outcome).toBe('ok');
    const serialized = JSON.stringify(report);
    for (const forbidden of Object.values(FORBIDDEN)) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain(USER_ID);

    const everyLoggedLine = logSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
    for (const forbidden of Object.values(FORBIDDEN)) {
      expect(everyLoggedLine).not.toContain(forbidden);
    }
  });
});
