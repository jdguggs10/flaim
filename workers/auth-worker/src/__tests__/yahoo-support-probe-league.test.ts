import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * probe-league: the support action that reproduces one live per-league Yahoo
 * fetch on demand.
 *
 * Same two halves as yahoo-support-diagnose.test.ts. The first drives
 * `probeYahooLeague` through mocked storage and a mocked `fetch`, pinning the
 * verbatim league-id substitution, the single-call bound, the shared guarded
 * renewal, and the write-path non-goals. The second drives
 * `runYahooSupportProbeLeague` with an injected probe result, so every
 * interpretation category is asserted against an exact, hand-built shape.
 *
 * Entirely offline: the only `fetch` is the mock, and it distinguishes Yahoo's
 * token endpoint from Yahoo's fantasy API so "zero Yahoo resource calls" is a
 * real assertion rather than a hopeful one.
 */

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
  probeYahooLeague,
  MAX_YAHOO_ERROR_DESCRIPTION_CHARS,
  YAHOO_SUPPORT_LEAGUE_ID_PATTERN,
  type YahooConnectEnv,
  type YahooDiagnosticCall,
  type YahooSupportLeagueProbe,
} from '../yahoo-connect-handlers';
import {
  runYahooSupportProbeLeague,
  type ProbeLeagueInterpretation,
  type YahooSupportEnv,
} from '../yahoo-support-diagnostics';
import { REFRESH_COOLDOWN_OWNER_PREFIX, YahooStorage } from '../yahoo-storage';

const USER_ID = 'user_3Ie4m68lUbzxyv22NsMU';
const MASKED_USER_ID = 'user_3Ie...';
const NOW_MS = Date.parse('2026-09-09T15:00:00.000Z');
const CHECKED_AT = '2026-09-09T15:00:00.000Z';

/** The identifier from the reported case: a bare numeric id, no game_key. */
const BARE_LEAGUE_ID = '153104';
const FULL_LEAGUE_KEY = '461.l.153104';

const YAHOO_FANTASY_HOST = 'https://fantasysports.yahooapis.com';
const YAHOO_TOKEN_HOST = 'https://api.login.yahoo.com';

function leagueUrl(leagueId: string): string {
  return `${YAHOO_FANTASY_HOST}/fantasy/v2/league/${leagueId}/teams?format=json`;
}

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
  leagueName: 'Sentinel Dynasty League',
  teamKey: '461.l.153104.t.7',
  teamName: 'Sentinel Sunday Squad',
  accessToken: 'ya29-sentinel-access-token',
  refreshToken: 'sentinel-refresh-token',
} as const;

/** The real Yahoo rejection this command exists to reproduce. */
const INVALID_GAME_KEY_DESCRIPTION = `Invalid game key provided - ${BARE_LEAGUE_ID}`;

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

function routeFetch(routes: { token?: () => Response; league?: () => Response }) {
  mockFetch.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith(YAHOO_TOKEN_HOST)) {
      return routes.token?.() ?? new Response('{}', { status: 500 });
    }
    if (url.startsWith(YAHOO_FANTASY_HOST)) {
      return routes.league?.() ?? new Response('{}', { status: 500 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A normal, populated `/league/{id}/teams` answer. */
function teamsPayload(): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: FULL_LEAGUE_KEY, name: FORBIDDEN.leagueName },
        { teams: { count: 1, 0: { team: [[{ team_key: FORBIDDEN.teamKey }, { name: FORBIDDEN.teamName }]] } } },
      ],
    },
  };
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
  routeFetch({ league: () => json(teamsPayload()) });

  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

function completedProbe(probe: YahooSupportLeagueProbe) {
  if (probe.stage !== 'completed') throw new Error(`expected a completed probe, got ${probe.stage}`);
  return probe;
}

// ===========================================================================
// probeYahooLeague — substitution, renewal, budget, non-goals
// ===========================================================================

describe('probeYahooLeague', () => {
  it('reports not_connected and touches Yahoo not at all when there is no credential row', async () => {
    mockStorage.getYahooCredentials.mockResolvedValue(null);

    const probe = await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1');

    expect(probe).toEqual({ stage: 'not_connected' });
    expect(mockStorage.getYahooCredentials).toHaveBeenCalledWith(USER_ID);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe('league id substitution', () => {
    // The whole point of the command: whatever the customer reported is what
    // Yahoo is asked for, with no game_key prefixing and no normalisation. A
    // probe that "helpfully" fixed the id would take a different path from the
    // code under investigation and prove nothing about it.
    it.each([
      ['a bare numeric id', BARE_LEAGUE_ID],
      ['a full league key', FULL_LEAGUE_KEY],
      ['an id with a hyphen and underscore', 'abc-123_x'],
    ])('substitutes %s verbatim', async (_label, leagueId) => {
      await probeYahooLeague(env, USER_ID, leagueId, 'corr-1');

      expect(fantasyApiCalls()).toEqual([leagueUrl(leagueId)]);
    });

    it('makes exactly one Yahoo resource call, whatever the answer', async () => {
      routeFetch({ league: () => json({ error: { description: INVALID_GAME_KEY_DESCRIPTION } }, 400) });

      const probe = await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1');

      expect(probe.stage).toBe('completed');
      expect(fantasyApiCalls()).toHaveLength(1);
    });

    it.each([
      ['a path traversal', '../../users'],
      ['a slash', '461/l/153104'],
      ['a query parameter', '153104?format=xml'],
      ['an empty string', ''],
      ['longer than the cap', 'a'.repeat(65)],
      ['a percent escape', '%2e%2e'],
    ])('refuses %s before any Yahoo call', async (_label, leagueId) => {
      await expect(probeYahooLeague(env, USER_ID, leagueId, 'corr-1')).rejects.toThrow(
        /charset check/
      );

      expect(mockFetch).not.toHaveBeenCalled();
      // The rejected value is never quoted back.
      expect(mockStorage.getYahooCredentials).not.toHaveBeenCalled();
    });

    it('accepts exactly what the exported pattern accepts', () => {
      expect(YAHOO_SUPPORT_LEAGUE_ID_PATTERN.test(BARE_LEAGUE_ID)).toBe(true);
      expect(YAHOO_SUPPORT_LEAGUE_ID_PATTERN.test(FULL_LEAGUE_KEY)).toBe(true);
      expect(YAHOO_SUPPORT_LEAGUE_ID_PATTERN.test('461/l/153104')).toBe(false);
    });
  });

  describe('guarded renewal', () => {
    it('runs the guarded token path even when the token is fresh', async () => {
      const probe = await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1');

      const events = yahooConnectDiagnostics();
      expect(events.map((entry) => entry.event)).toContain('token_fresh_returned');
      expect(tokenEndpointCalls()).toHaveLength(0);

      const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FORBIDDEN.accessToken}`);
      expect(probe.stage).toBe('completed');
    });

    it('renews an expired token through the lease and uses the renewed token', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue(staleCredentials());
      routeFetch({
        token: () => json({ access_token: 'renewed-token', refresh_token: 'renewed-refresh', expires_in: 3600, token_type: 'bearer' }),
        league: () => json(teamsPayload()),
      });

      const probe = await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1');

      expect(mockStorage.acquireRefreshLease).toHaveBeenCalledTimes(1);
      expect(tokenEndpointCalls()).toHaveLength(1);
      const leagueCall = mockFetch.mock.calls.find(([url]) => String(url) === leagueUrl(BARE_LEAGUE_ID));
      expect((leagueCall?.[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer renewed-token' });
      expect(probe.stage).toBe('completed');
    });

    // Identical stop-here shape to diagnoseYahooDiscovery's — both go through
    // the same `toCredentialRefreshFailure` projection.
    describe('stops at credential_refresh_failed, with zero Yahoo resource calls', () => {
      it('for a cooldown', async () => {
        mockStorage.getYahooCredentials.mockResolvedValue(
          staleCredentials({
            refreshLeaseOwner: `${REFRESH_COOLDOWN_OWNER_PREFIX}abc`,
            refreshLeaseExpiresAt: new Date(Date.now() + 45_000),
          })
        );

        const probe = await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1');

        expect(probe).toMatchObject({
          stage: 'credential_refresh_failed',
          errorCode: 'refresh_temporarily_unavailable',
          retryable: true,
          appFingerprintMismatch: false,
        });
        expect(probe).toHaveProperty('retryAfterSeconds');
        expect(fantasyApiCalls()).toHaveLength(0);
      });

      it('for an app-fingerprint mismatch', async () => {
        mockStorage.getYahooCredentials.mockResolvedValue(staleCredentials({ appFingerprint: 'ffffffffffff' }));

        const probe = await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1');

        expect(probe).toMatchObject({
          stage: 'credential_refresh_failed',
          errorCode: 'app_fingerprint_mismatch',
          appFingerprintMismatch: true,
        });
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('for a permanent rejection of the stored grant', async () => {
        mockStorage.getYahooCredentials.mockResolvedValue(staleCredentials());
        routeFetch({ token: () => json({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, 400) });

        const probe = await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1');

        expect(probe).toMatchObject({
          stage: 'credential_refresh_failed',
          errorCode: 'refresh_failed',
          upstreamStatus: 400,
          appFingerprintMismatch: false,
        });
        expect(probe).not.toHaveProperty('retryable');
        expect(fantasyApiCalls()).toHaveLength(0);
      });
    });
  });

  describe('call classification', () => {
    it('records a clean answer as a labelled envelope', async () => {
      const probe = completedProbe(await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1'));

      expect(probe.call).toMatchObject({
        label: 'league_teams',
        url: leagueUrl(BARE_LEAGUE_ID),
        httpStatus: 200,
        ok: true,
        bodyIsJson: true,
        bodyLooksLikeEnvelope: true,
        errorSnippetCategory: 'none',
      });
      expect(typeof probe.call.durationMs).toBe('number');
      expect(probe.errorDescription).toBeUndefined();
    });

    it.each<[string, () => Response, YahooDiagnosticCall['errorSnippetCategory']]>([
      ['an empty body', () => new Response('', { status: 200 }), 'empty'],
      ['an HTML error page', () => new Response('<!DOCTYPE html><html>Yahoo</html>', { status: 503 }), 'html'],
      ['a Yahoo JSON error envelope', () => json({ error: { description: 'denied' } }, 400), 'yahoo_error_json'],
      ['an unparseable body', () => new Response('not json at all', { status: 200 }), 'unparseable'],
    ])('categorizes %s', async (_label, league, expected) => {
      routeFetch({ league });

      const probe = completedProbe(await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1'));

      expect(probe.call.errorSnippetCategory).toBe(expected);
    });

    it('records a transport failure as one call with no status', async () => {
      routeFetch({
        league: () => {
          throw new Error('network down');
        },
      });

      const probe = completedProbe(await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1'));

      expect(probe.call).toMatchObject({ httpStatus: null, ok: false });
      expect(probe.errorDescription).toBeUndefined();
    });
  });

  describe('error description projection', () => {
    it('lifts Yahoo\'s nested error.description', async () => {
      routeFetch({ league: () => json({ error: { description: INVALID_GAME_KEY_DESCRIPTION, lang: 'en-US' } }, 400) });

      const probe = completedProbe(await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1'));

      expect(probe.errorDescription).toBe(INVALID_GAME_KEY_DESCRIPTION);
    });

    it('lifts a top-level description when there is no nested one', async () => {
      routeFetch({ league: () => json({ description: 'Something went wrong', error: {} }, 400) });

      const probe = completedProbe(await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1'));

      expect(probe.errorDescription).toBe('Something went wrong');
    });

    it('falls back to a bare string error', async () => {
      routeFetch({ league: () => json({ error: 'invalid_request' }, 400) });

      const probe = completedProbe(await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1'));

      expect(probe.errorDescription).toBe('invalid_request');
    });

    it('caps a long description', async () => {
      routeFetch({ league: () => json({ error: { description: 'x'.repeat(500) } }, 400) });

      const probe = completedProbe(await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1'));

      expect(probe.errorDescription).toHaveLength(MAX_YAHOO_ERROR_DESCRIPTION_CHARS);
    });

    // Only a body that actually classified as a Yahoo error JSON is projected.
    // A valid envelope, an HTML page, or an unparseable body yields nothing —
    // the "never surface free provider text" rule holds everywhere else.
    it.each([
      ['a valid envelope', () => json(teamsPayload())],
      ['an HTML error page', () => new Response('<html>Yahoo is down for maintenance</html>', { status: 503 })],
      ['an unparseable body', () => new Response('total nonsense', { status: 500 })],
      ['an empty body', () => new Response('', { status: 500 })],
    ])('projects nothing from %s', async (_label, league) => {
      routeFetch({ league });

      const probe = completedProbe(await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1'));

      expect(probe.errorDescription).toBeUndefined();
    });

    it('projects nothing when the error object carries no readable text', async () => {
      routeFetch({ league: () => json({ error: { code: 400 } }, 400) });

      const probe = completedProbe(await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1'));

      expect(probe.errorDescription).toBeUndefined();
    });
  });

  describe('write-path non-goals', () => {
    it.each([
      ['a clean answer', () => {}],
      ['a Yahoo rejection', () => routeFetch({ league: () => json({ error: { description: 'nope' } }, 400) })],
      ['not connected', () => mockStorage.getYahooCredentials.mockResolvedValue(null)],
      ['renewal rejected', () => {
        mockStorage.getYahooCredentials.mockResolvedValue(staleCredentials({ appFingerprint: 'ffffffffffff' }));
      }],
    ])('persists nothing on %s', async (_label, arrange) => {
      arrange();

      await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1');

      expect(mockStorage.upsertYahooLeague).not.toHaveBeenCalled();
      expect(mockStorage.deleteAllYahooLeagues).not.toHaveBeenCalled();
      expect(writeSpies.syncStateConstructed).not.toHaveBeenCalled();
      expect(writeSpies.settle).not.toHaveBeenCalled();
      expect(writeSpies.acquireLease).not.toHaveBeenCalled();
      expect(writeSpies.refreshLeaguesForUser).not.toHaveBeenCalled();
    });

    // The probe never reads yahoo_leagues — that is why it may project Yahoo's
    // own error text at all.
    it('never reads the stored league table', async () => {
      await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1');

      expect(mockStorage.getYahooLeagues).not.toHaveBeenCalled();
    });
  });

  it('never lets a customer identifier out of a successful probe', async () => {
    const probe = await probeYahooLeague(env, USER_ID, BARE_LEAGUE_ID, 'corr-1');
    const serialized = JSON.stringify(probe);

    for (const forbidden of Object.values(FORBIDDEN)) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
// runYahooSupportProbeLeague — report envelope, interpretation, audit log
// ===========================================================================

function probeCall(overrides: Partial<YahooDiagnosticCall> = {}): YahooDiagnosticCall {
  return {
    label: 'league_teams',
    url: leagueUrl(BARE_LEAGUE_ID),
    httpStatus: 200,
    ok: true,
    bodyIsJson: true,
    bodyLooksLikeEnvelope: true,
    errorSnippetCategory: 'none',
    stats: null,
    parsedLeagueCount: null,
    durationMs: 42,
    ...overrides,
  };
}

function runWith(result: YahooSupportLeagueProbe) {
  const probe = vi.fn().mockResolvedValue(result);
  return {
    probe,
    result: runYahooSupportProbeLeague(
      supportEnv,
      { userId: USER_ID, leagueId: BARE_LEAGUE_ID },
      { now: () => NOW_MS, probe }
    ),
  };
}

async function categoryOf(result: YahooSupportLeagueProbe): Promise<ProbeLeagueInterpretation> {
  const report = await runWith(result).result;
  if (report.outcome !== 'ok') throw new Error('expected an ok report');
  return report.interpretation;
}

describe('runYahooSupportProbeLeague', () => {
  it('wraps the probe in a stable report envelope', async () => {
    const { probe, result } = runWith({ stage: 'completed', call: probeCall() });
    const report = await result;

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(supportEnv, USER_ID, BARE_LEAGUE_ID, expect.any(String));
    expect(report).toMatchObject({ outcome: 'ok', userMasked: MASKED_USER_ID, checkedAt: CHECKED_AT });
    if (report.outcome !== 'ok') throw new Error('expected an ok report');
    expect(report.correlationId).toEqual(expect.any(String));
    expect(probe.mock.calls[0][3]).toBe(report.correlationId);
  });

  // The projection is the redaction boundary: the URL carries the substituted
  // league id, and the discovery parser's stats mean nothing here.
  it('projects the call without the url or the discovery stats', async () => {
    const report = await runWith({
      stage: 'completed',
      call: probeCall({ httpStatus: 400, ok: false, durationMs: 118 }),
    }).result;

    if (report.outcome !== 'ok') throw new Error('expected an ok report');
    expect(report.call).toEqual({
      label: 'league_teams',
      httpStatus: 400,
      ok: false,
      bodyIsJson: true,
      bodyLooksLikeEnvelope: true,
      errorSnippetCategory: 'none',
      durationMs: 118,
    });
    expect(JSON.stringify(report)).not.toContain('fantasysports.yahooapis.com');
  });

  it.each([
    ['not connected', { stage: 'not_connected' } as const],
    [
      'renewal rejected',
      { stage: 'credential_refresh_failed', errorCode: 'refresh_failed', appFingerprintMismatch: false } as const,
    ],
  ])('reports a null call when the probe stopped at %s', async (_label, probeResult) => {
    const report = await runWith(probeResult).result;

    if (report.outcome !== 'ok') throw new Error('expected an ok report');
    expect(report.call).toBeNull();
  });

  it('collapses a thrown error into probe_failed without leaking its message', async () => {
    const probe = vi.fn().mockRejectedValue(new Error(`storage exploded on ${FORBIDDEN.teamKey}`));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const report = await runYahooSupportProbeLeague(
      supportEnv,
      { userId: USER_ID, leagueId: BARE_LEAGUE_ID },
      { now: () => NOW_MS, probe }
    );

    expect(report).toEqual({ outcome: 'failed', userMasked: MASKED_USER_ID, error: 'probe_failed' });
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain(FORBIDDEN.teamKey);
    expect(logged).toContain('Error');
  });

  describe('interpretation', () => {
    it('classifies a missing connection with the same sentence diagnose uses', async () => {
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

    it('classifies a retryable cooldown distinctly, naming the wait and this command', async () => {
      const interpretation = await categoryOf({
        stage: 'credential_refresh_failed',
        errorCode: 'refresh_temporarily_unavailable',
        retryable: true,
        retryAfterSeconds: 45,
        appFingerprintMismatch: false,
      });

      expect(interpretation.category).toBe('credential_renewal_rejected');
      expect(interpretation.nextAction).toContain('45 seconds');
      expect(interpretation.nextAction).toContain('probe-league');
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

    it('classifies a clean 200 envelope as succeeded', async () => {
      const interpretation = await categoryOf({ stage: 'completed', call: probeCall() });

      expect(interpretation.category).toBe('succeeded');
      expect(interpretation.nextAction).toMatch(/retry/i);
      expect(interpretation.errorDescription).toBeUndefined();
    });

    // The case this command exists for.
    it('classifies a Yahoo error body as yahoo_rejected and carries the description', async () => {
      const interpretation = await categoryOf({
        stage: 'completed',
        call: probeCall({
          httpStatus: 400,
          ok: false,
          bodyLooksLikeEnvelope: false,
          errorSnippetCategory: 'yahoo_error_json',
        }),
        errorDescription: INVALID_GAME_KEY_DESCRIPTION,
      });

      expect(interpretation.category).toBe('yahoo_rejected');
      expect(interpretation.errorDescription).toBe(INVALID_GAME_KEY_DESCRIPTION);
      expect(interpretation.summary).toContain('400');
      // Explicitly not a reconnect: the credential worked.
      expect(interpretation.nextAction).toMatch(/do not tell the customer to reconnect/i);
    });

    it('omits the description entirely when the probe did not project one', async () => {
      const interpretation = await categoryOf({
        stage: 'completed',
        call: probeCall({ httpStatus: 400, ok: false, bodyLooksLikeEnvelope: false, errorSnippetCategory: 'yahoo_error_json' }),
      });

      expect(interpretation.category).toBe('yahoo_rejected');
      expect(interpretation).not.toHaveProperty('errorDescription');
    });

    it.each([429, 999])('classifies HTTP %i as throttling, ahead of the payload shape', async (status) => {
      const interpretation = await categoryOf({
        stage: 'completed',
        call: probeCall({
          httpStatus: status,
          ok: false,
          bodyIsJson: true,
          bodyLooksLikeEnvelope: false,
          errorSnippetCategory: 'yahoo_error_json',
        }),
        errorDescription: 'please slow down',
      });

      expect(interpretation.category).toBe('throttled');
      expect(interpretation.nextAction).toMatch(/never loop/i);
      // Throttling outranks the error body, and takes its description with it.
      expect(interpretation.errorDescription).toBeUndefined();
    });

    it.each<[string, Partial<YahooDiagnosticCall>]>([
      ['an HTML error page', { httpStatus: 503, ok: false, bodyIsJson: false, bodyLooksLikeEnvelope: false, errorSnippetCategory: 'html' }],
      ['an unparseable body', { httpStatus: 200, bodyIsJson: false, bodyLooksLikeEnvelope: false, errorSnippetCategory: 'unparseable' }],
      ['an empty body', { httpStatus: 500, ok: false, bodyIsJson: false, bodyLooksLikeEnvelope: false, errorSnippetCategory: 'empty' }],
      ['a transport failure', { httpStatus: null, ok: false, bodyIsJson: false, bodyLooksLikeEnvelope: false, errorSnippetCategory: 'unparseable' }],
      ['a non-200 JSON body with no error marker', { httpStatus: 500, ok: false, bodyLooksLikeEnvelope: false, errorSnippetCategory: 'none' }],
    ])('classifies %s as a malformed payload', async (_label, overrides) => {
      const interpretation = await categoryOf({ stage: 'completed', call: probeCall(overrides) });

      expect(interpretation.category).toBe('malformed_payload');
      expect(interpretation.nextAction).toMatch(/never the body/i);
    });

    // A 200 that is JSON but not an envelope is not a success, whatever the
    // status says.
    it('does not call a 200 without an envelope a success', async () => {
      const interpretation = await categoryOf({
        stage: 'completed',
        call: probeCall({ bodyLooksLikeEnvelope: false, errorSnippetCategory: 'yahoo_error_json' }),
      });

      expect(interpretation.category).toBe('yahoo_rejected');
    });
  });

  describe('audit log', () => {
    it('writes one line that masks the user id, names the category, and omits the league id', async () => {
      await runWith({
        stage: 'completed',
        call: probeCall({ httpStatus: 400, ok: false, bodyLooksLikeEnvelope: false, errorSnippetCategory: 'yahoo_error_json' }),
        errorDescription: INVALID_GAME_KEY_DESCRIPTION,
      }).result;

      const auditLines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('yahoo_support_probe_league'));
      expect(auditLines).toHaveLength(1);

      const audit = JSON.parse(auditLines[0]) as Record<string, unknown>;
      expect(audit).toMatchObject({
        event: 'yahoo_support_probe_league',
        service: 'auth-worker',
        user_id: MASKED_USER_ID,
        outcome: 'ok',
        stage: 'completed',
        category: 'yahoo_rejected',
      });
      expect(typeof audit.correlation_id).toBe('string');
      expect(auditLines[0]).not.toContain(USER_ID);
      expect(auditLines[0]).not.toContain(BARE_LEAGUE_ID);
      expect(auditLines[0]).not.toContain(INVALID_GAME_KEY_DESCRIPTION);
    });

    it('reports a null stage and category when the probe failed', async () => {
      const probe = vi.fn().mockRejectedValue(new Error('boom'));
      await runYahooSupportProbeLeague(
        supportEnv,
        { userId: USER_ID, leagueId: BARE_LEAGUE_ID },
        { now: () => NOW_MS, probe }
      );

      const audit = JSON.parse(
        logSpy.mock.calls.map((call) => String(call[0])).find((line) => line.includes('yahoo_support_probe_league')) ?? '{}'
      ) as Record<string, unknown>;

      expect(audit).toMatchObject({ outcome: 'failed', stage: null, category: null });
    });
  });

  it('carries no customer identifier anywhere in the report, end to end', async () => {
    // The full stack this time: real probe, real classification, rich payload.
    const report = await runYahooSupportProbeLeague(
      supportEnv,
      { userId: USER_ID, leagueId: BARE_LEAGUE_ID },
      { now: () => NOW_MS }
    );

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
