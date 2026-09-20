import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../yahoo-storage', async () => {
  const actual = await vi.importActual<typeof import('../yahoo-storage')>('../yahoo-storage');
  return { ...actual, YahooStorage: { ...actual.YahooStorage, fromEnvironment: vi.fn() } };
});

import {
  recoverYahooLeagueForSupport,
  YAHOO_SUPPORT_RECOVERY_MAX_RENEW_HOPS,
  YAHOO_SUPPORT_RECOVERY_TIMEOUT_MS,
  type YahooConnectEnv,
} from '../yahoo-connect-handlers';
import {
  parseYahooSupportLeagueRecoveryRequest,
  runYahooSupportRecoverLeague,
  type YahooSupportEnv,
} from '../yahoo-support-diagnostics';
import { YahooStorage } from '../yahoo-storage';

const USER_ID = 'user_3Ie4m68lUbzxyv22NsMU';
const LEAGUE_KEY = '470.l.1234567';
const TEAM_KEY = `${LEAGUE_KEY}.t.3`;
const ACCESS_TOKEN = 'sentinel-access-token';
const REFRESH_TOKEN = 'sentinel-refresh-token';
const LEAGUE_NAME = 'Sentinel League Name';
const TEAM_NAME = 'Sentinel Team Name';
const YAHOO_GUID = 'sentinel-yahoo-guid';
const env: YahooConnectEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  YAHOO_CLIENT_ID: 'test-client',
  YAHOO_CLIENT_SECRET: 'test-secret',
  ENVIRONMENT: 'test',
};

type MockStorage = {
  getYahooCredentials: ReturnType<typeof vi.fn>;
  getYahooLeaguesForSupportReadback: ReturnType<typeof vi.fn>;
  upsertYahooLeagueWithRecurringId: ReturnType<typeof vi.fn>;
};

let storage: MockStorage;
let fetchSpy: ReturnType<typeof vi.fn>;
let logSpy: ReturnType<typeof vi.spyOn>;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function metadataPayload(options: { leagueKey?: string; renew?: string; gameCode?: string; season?: unknown; name?: string } = {}) {
  return {
    fantasy_content: {
      league: [{
        league_key: options.leagueKey ?? LEAGUE_KEY,
        game_code: options.gameCode ?? 'nfl',
        season: options.season ?? '2026',
        name: options.name ?? LEAGUE_NAME,
        ...(Object.hasOwn(options, 'renew') ? { renew: options.renew } : { renew: '' }),
      }],
    },
  };
}

function teamsPayload(options: { ownership?: 0 | 1 | undefined; managerGuid?: string; teamKey?: string; teamName?: string; secondOwned?: boolean } = {}) {
  const firstTeam = [
    { team_key: options.teamKey ?? TEAM_KEY },
    { name: options.teamName ?? TEAM_NAME },
    ...(options.ownership === undefined ? [] : [{ is_owned_by_current_login: options.ownership }]),
    { managers: { count: 1, 0: { manager: [{ guid: options.managerGuid ?? YAHOO_GUID }] } } },
  ];
  return {
    fantasy_content: {
      league: [
        { league_key: LEAGUE_KEY },
        {
          teams: {
            count: options.secondOwned ? 2 : 1,
            0: { team: firstTeam },
            ...(options.secondOwned ? {
              1: {
                team: [
                  { team_key: `${LEAGUE_KEY}.t.4` },
                  { name: 'Second Sentinel Team' },
                  { is_owned_by_current_login: 1 },
                  { managers: { count: 1, 0: { manager: [{ guid: 'second-guid' }] } } },
                ],
              },
            } : {}),
          },
        },
      ],
    },
  };
}

function loginPayload(guid = YAHOO_GUID) {
  return { fantasy_content: { users: { count: 1, 0: { user: [{ guid }] } } } };
}

function rootMetadataPayload(leagueKey: string, renew: string) {
  return { fantasy_content: { league: [{ league_key: leagueKey, renew }] } };
}

function visibleLeague() {
  return {
    id: 'stored-row',
    clerkUserId: USER_ID,
    sport: 'football' as const,
    seasonYear: 2026,
    leagueKey: LEAGUE_KEY,
    leagueName: LEAGUE_NAME,
    teamId: '3',
    teamKey: TEAM_KEY,
    teamName: TEAM_NAME,
    recurringLeagueId: LEAGUE_KEY,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storage = {
    getYahooCredentials: vi.fn().mockResolvedValue({
      clerkUserId: USER_ID,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      yahooGuid: YAHOO_GUID,
      expiresAt: new Date(Date.now() + 60_000),
      needsRefresh: false,
    }),
    getYahooLeaguesForSupportReadback: vi.fn().mockResolvedValue([]),
    upsertYahooLeagueWithRecurringId: vi.fn().mockResolvedValue('stored-row'),
  };
  vi.mocked(YahooStorage.fromEnvironment).mockReturnValue(storage as unknown as YahooStorage);
  fetchSpy = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes(`/league/${LEAGUE_KEY}/teams`)) return json(teamsPayload({ ownership: 1 }));
    if (url.includes(`/league/${LEAGUE_KEY}?`)) return json(metadataPayload());
    if (url.includes('/users;use_login=1')) return json(loginPayload());
    throw new Error('unexpected Yahoo request');
  });
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('recoverYahooLeagueForSupport', () => {
  it('persists one direct-ownership-proven current league and reports only a closed status', async () => {
    storage.getYahooLeaguesForSupportReadback
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([visibleLeague()]);

    const result = await recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY, 'correlation-id');

    expect(result).toEqual({ stage: 'recovered', status: 'persisted_visible' });
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      `https://fantasysports.yahooapis.com/fantasy/v2/league/${LEAGUE_KEY}?format=json`,
      `https://fantasysports.yahooapis.com/fantasy/v2/league/${LEAGUE_KEY}/teams?format=json`,
    ]);
    expect(storage.getYahooLeaguesForSupportReadback).toHaveBeenNthCalledWith(1, USER_ID, 'exclude-archived');
    expect(storage.getYahooLeaguesForSupportReadback).toHaveBeenNthCalledWith(2, USER_ID, 'exclude-archived');
    expect(storage.upsertYahooLeagueWithRecurringId).toHaveBeenCalledTimes(1);
    expect(storage.upsertYahooLeagueWithRecurringId).toHaveBeenCalledWith({
      clerkUserId: USER_ID,
      sport: 'football',
      seasonYear: 2026,
      leagueKey: LEAGUE_KEY,
      leagueName: LEAGUE_NAME,
      teamId: '3',
      teamKey: TEAM_KEY,
      teamName: TEAM_NAME,
      recurringLeagueId: LEAGUE_KEY,
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [USER_ID, LEAGUE_KEY, TEAM_KEY, YAHOO_GUID, ACCESS_TOKEN, REFRESH_TOKEN, LEAGUE_NAME, TEAM_NAME]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('accepts a fresh use_login GUID only when direct ownership metadata is absent and exactly one manager matches', async () => {
    storage.getYahooLeaguesForSupportReadback
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([visibleLeague()]);
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes(`/league/${LEAGUE_KEY}/teams`)) return json(teamsPayload({ ownership: undefined }));
      if (url.includes(`/league/${LEAGUE_KEY}?`)) return json(metadataPayload());
      if (url.includes('/users;use_login=1')) return json(loginPayload());
      throw new Error('unexpected Yahoo request');
    });

    await expect(recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY)).resolves.toEqual({
      stage: 'recovered', status: 'persisted_visible',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toContain(
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1?format=json'
    );
    expect(storage.upsertYahooLeagueWithRecurringId).toHaveBeenCalledTimes(1);
  });

  it('fails closed without a write when metadata does not echo the exact key, the sport/season/name are invalid, or ownership is ambiguous', async () => {
    const cases: Array<{ name: string; metadata?: ReturnType<typeof metadataPayload>; teams?: ReturnType<typeof teamsPayload> }> = [
      { name: 'wrong metadata key', metadata: metadataPayload({ leagueKey: '470.l.7654321' }) },
      { name: 'unsupported game code', metadata: metadataPayload({ gameCode: 'cfb' }) },
      { name: 'non-current season', metadata: metadataPayload({ season: '2025' }) },
      { name: 'blank league name', metadata: metadataPayload({ name: '  ' }) },
      { name: 'invalid team key', teams: teamsPayload({ ownership: 1, teamKey: '470.l.9999999.t.3' }) },
      { name: 'blank team name', teams: teamsPayload({ ownership: 1, teamName: ' ' }) },
      { name: 'two directly owned teams', teams: teamsPayload({ ownership: 1, secondOwned: true }) },
    ];

    for (const scenario of cases) {
      vi.clearAllMocks();
      storage.getYahooCredentials.mockResolvedValue({
        clerkUserId: USER_ID, accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN,
        expiresAt: new Date(Date.now() + 60_000), needsRefresh: false,
      });
      storage.getYahooLeaguesForSupportReadback.mockResolvedValue([]);
      storage.upsertYahooLeagueWithRecurringId.mockResolvedValue('stored-row');
      fetchSpy.mockImplementation(async (input: unknown) => {
        const url = String(input);
        if (url.includes(`/league/${LEAGUE_KEY}/teams`)) return json(scenario.teams ?? teamsPayload({ ownership: 1 }));
        if (url.includes(`/league/${LEAGUE_KEY}?`)) return json(scenario.metadata ?? metadataPayload());
        if (url.includes('/users;use_login=1')) return json(loginPayload());
        throw new Error(`unexpected Yahoo request for ${scenario.name}`);
      });

      await expect(recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY)).resolves.toEqual({ stage: 'failed' });
      expect(storage.upsertYahooLeagueWithRecurringId, scenario.name).not.toHaveBeenCalled();
    }
  });

  it('does not override a complete direct non-owner verdict with manager data', async () => {
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes(`/league/${LEAGUE_KEY}/teams`)) return json(teamsPayload({ ownership: 0 }));
      if (url.includes(`/league/${LEAGUE_KEY}?`)) return json(metadataPayload());
      throw new Error('fresh login must not be fetched after a complete non-owner verdict');
    });

    await expect(recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY)).resolves.toEqual({ stage: 'failed' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(storage.upsertYahooLeagueWithRecurringId).not.toHaveBeenCalled();
  });

  it('fails closed on an unresolved or cyclic renew chain before its one upsert', async () => {
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes(`/league/${LEAGUE_KEY}/teams`)) return json(teamsPayload({ ownership: 1 }));
      if (url.includes(`/league/${LEAGUE_KEY}?`)) return json(metadataPayload({ renew: '470_1234567' }));
      throw new Error('unexpected Yahoo request');
    });

    await expect(recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY)).resolves.toEqual({ stage: 'failed' });
    expect(storage.upsertYahooLeagueWithRecurringId).not.toHaveBeenCalled();
  });

  it('treats only absent or blank renew as a terminator and rejects malformed nonblank pointers', async () => {
    storage.getYahooLeaguesForSupportReadback
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([visibleLeague()]);
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes(`/league/${LEAGUE_KEY}/teams`)) return json(teamsPayload({ ownership: 1 }));
      if (url.includes(`/league/${LEAGUE_KEY}?`)) return json(metadataPayload({ renew: undefined }));
      throw new Error('unexpected Yahoo request');
    });
    await expect(recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY)).resolves.toEqual({
      stage: 'recovered', status: 'persisted_visible',
    });

    vi.clearAllMocks();
    storage.getYahooCredentials.mockResolvedValue({
      clerkUserId: USER_ID, accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN,
      expiresAt: new Date(Date.now() + 60_000), needsRefresh: false,
    });
    storage.getYahooLeaguesForSupportReadback.mockResolvedValue([]);
    storage.upsertYahooLeagueWithRecurringId.mockResolvedValue('stored-row');
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes(`/league/${LEAGUE_KEY}/teams`)) return json(teamsPayload({ ownership: 1 }));
      if (url.includes(`/league/${LEAGUE_KEY}?`)) return json(metadataPayload({ renew: '470_not-a-number' }));
      throw new Error('malformed renew must not issue a root fetch');
    });
    await expect(recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY)).resolves.toEqual({ stage: 'failed' });
    expect(storage.upsertYahooLeagueWithRecurringId).not.toHaveBeenCalled();
  });

  it('allows exactly the configured number of valid renew hops when the final fetched node terminates', async () => {
    const rootKeys = Array.from(
      { length: YAHOO_SUPPORT_RECOVERY_MAX_RENEW_HOPS },
      (_, index) => `470.l.${9000000 + index}`
    );
    storage.getYahooLeaguesForSupportReadback
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([visibleLeague()]);
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes(`/league/${LEAGUE_KEY}/teams`)) return json(teamsPayload({ ownership: 1 }));
      if (url.includes(`/league/${LEAGUE_KEY}?`)) return json(metadataPayload({ renew: '470_9000000' }));
      const rootIndex = rootKeys.findIndex((key) => url.includes(`/league/${key}?`));
      if (rootIndex >= 0) {
        const renew = rootIndex === rootKeys.length - 1
          ? ''
          : `470_${9000000 + rootIndex + 1}`;
        return json(rootMetadataPayload(rootKeys[rootIndex], renew));
      }
      throw new Error('unexpected Yahoo request');
    });

    await expect(recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY)).resolves.toEqual({
      stage: 'recovered', status: 'persisted_visible',
    });
    expect(storage.upsertYahooLeagueWithRecurringId).toHaveBeenCalledWith(
      expect.objectContaining({ recurringLeagueId: rootKeys.at(-1) })
    );
    expect(fetchSpy).toHaveBeenCalledTimes(YAHOO_SUPPORT_RECOVERY_MAX_RENEW_HOPS + 2);
  });

  it('fails closed on one renew hop beyond the configured maximum without fetching it', async () => {
    const rootKeys = Array.from(
      { length: YAHOO_SUPPORT_RECOVERY_MAX_RENEW_HOPS },
      (_, index) => `470.l.${8000000 + index}`
    );
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes(`/league/${LEAGUE_KEY}/teams`)) return json(teamsPayload({ ownership: 1 }));
      if (url.includes(`/league/${LEAGUE_KEY}?`)) return json(metadataPayload({ renew: '470_8000000' }));
      const rootIndex = rootKeys.findIndex((key) => url.includes(`/league/${key}?`));
      if (rootIndex >= 0) {
        const renew = rootIndex === rootKeys.length - 1
          ? '470_8000025'
          : `470_${8000000 + rootIndex + 1}`;
        return json(rootMetadataPayload(rootKeys[rootIndex], renew));
      }
      throw new Error('the MAX+1 root must not be fetched');
    });

    await expect(recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY)).resolves.toEqual({ stage: 'failed' });
    expect(storage.upsertYahooLeagueWithRecurringId).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(YAHOO_SUPPORT_RECOVERY_MAX_RENEW_HOPS + 2);
  });

  it('checks the whole-operation deadline immediately before the strict persistence write', async () => {
    let now = 0;
    storage.getYahooLeaguesForSupportReadback.mockImplementation(async () => {
      now = YAHOO_SUPPORT_RECOVERY_TIMEOUT_MS;
      return [];
    });

    await expect(recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY, undefined, { now: () => now })).resolves.toEqual({
      stage: 'failed',
    });
    expect(storage.upsertYahooLeagueWithRecurringId).not.toHaveBeenCalled();
  });

  it('reports a suppressed row and readback uncertainty without exposing archive state', async () => {
    storage.getYahooLeaguesForSupportReadback
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await expect(recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY)).resolves.toEqual({
      stage: 'recovered', status: 'persisted_suppressed',
    });

    storage.getYahooLeaguesForSupportReadback
      .mockReset()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('storage failure'));
    await expect(recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY)).resolves.toEqual({
      stage: 'recovered', status: 'visibility_unverified',
    });
  });

  it('returns already_present_visible after its idempotent write when the exact key was already active', async () => {
    storage.getYahooLeaguesForSupportReadback
      .mockResolvedValueOnce([visibleLeague()])
      .mockResolvedValueOnce([visibleLeague()]);
    await expect(recoverYahooLeagueForSupport(env, USER_ID, LEAGUE_KEY)).resolves.toEqual({
      stage: 'recovered', status: 'already_present_visible',
    });
    expect(storage.upsertYahooLeagueWithRecurringId).toHaveBeenCalledTimes(1);
  });
});

describe('support recovery request/report boundary', () => {
  it('accepts only the exact full-key request shape', async () => {
    await expect(parseYahooSupportLeagueRecoveryRequest(new Request('https://example.test', {
      method: 'POST', body: JSON.stringify({ userId: USER_ID, leagueKey: LEAGUE_KEY }),
    }))).resolves.toEqual({ request: { userId: USER_ID, leagueKey: LEAGUE_KEY } });

    await expect(parseYahooSupportLeagueRecoveryRequest(new Request('https://example.test', {
      method: 'POST', body: JSON.stringify({ userId: USER_ID, leagueKey: '1234567' }),
    }))).resolves.toMatchObject({ error: { body: { error: 'invalid_league_key' } } });
  });

  it('returns only the contract fields and logs only masked/closed recovery data', async () => {
    const report = await runYahooSupportRecoverLeague(
      env as YahooSupportEnv,
      { userId: USER_ID, leagueKey: LEAGUE_KEY },
      {
        now: () => Date.parse('2026-09-20T15:00:00.000Z'),
        recover: vi.fn().mockResolvedValue({ stage: 'recovered', status: 'persisted_visible' }),
      }
    );
    expect(report).toMatchObject({
      outcome: 'ok',
      userMasked: 'user_3Ie...',
      checkedAt: '2026-09-20T15:00:00.000Z',
      result: { status: 'persisted_visible' },
    });
    const serialized = JSON.stringify(report);
    for (const forbidden of [USER_ID, LEAGUE_KEY, TEAM_KEY, YAHOO_GUID, ACCESS_TOKEN, REFRESH_TOKEN, LEAGUE_NAME, TEAM_NAME]) {
      expect(serialized).not.toContain(forbidden);
    }
    const log = logSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(log).toContain('"event":"yahoo_support_recover_league"');
    expect(log).toContain('"status":"persisted_visible"');
    for (const forbidden of [USER_ID, LEAGUE_KEY, TEAM_KEY, YAHOO_GUID, ACCESS_TOKEN, REFRESH_TOKEN, LEAGUE_NAME, TEAM_NAME]) {
      expect(log).not.toContain(forbidden);
    }
  });
});
