import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  executeEspnTransactionOperation,
  fetchEspnTransactionsByWindow,
  getEspnLeagueContext,
  normalizeMTransactions2,
  parseMatchupScoringPeriods,
  resolveEspnTransactionWindow,
  type EspnLeagueContext,
  type EspnTransactionWindow,
} from '../espn-transactions';
import {
  findScoringPeriodForDate,
  resolveDateForScoringPeriod,
} from '../scoring-period';

vi.mock('../scoring-period', async () => {
  const actual = await vi.importActual<typeof import('../scoring-period')>('../scoring-period');
  return {
    ...actual,
    resolveDateForScoringPeriod: vi.fn(),
    findScoringPeriodForDate: vi.fn(),
  };
});

const credentials = { s2: 'token', swid: '{swid}' };
const dailyContext: EspnLeagueContext = {
  scoringPeriodId: 26,
  currentMatchupPeriod: 3,
  matchupPeriods: {
    1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    2: [13, 14, 15, 16, 17, 18, 19],
    3: [20, 21, 22, 23, 24, 25, 26],
  },
  scheduledMatchupPeriodIds: [1, 2, 3, 4],
  teams: {},
};

function dailyWindow(overrides: Partial<EspnTransactionWindow> = {}): EspnTransactionWindow {
  return {
    mode: 'explicit_week',
    requestedWeek: 4,
    normalization: 'none',
    matchupPeriodIds: [4],
    scoringPeriodIds: [22, 23, 24, 25, 26],
    scoringToMatchup: new Map([
      [22, 4],
      [23, 4],
      [24, 4],
      [25, 4],
      [26, 4],
    ]),
    firstScoringPeriodId: 22,
    lastScoringPeriodId: 26,
    startDate: '2026-04-20',
    endDate: '2026-04-24',
    dateBoundsKind: 'exact_contiguous',
    timezone: 'America/New_York',
    ...overrides,
  };
}

describe('ESPN transaction matchup-window contract', () => {
  const resolveDateMock =
    resolveDateForScoringPeriod as MockedFunction<typeof resolveDateForScoringPeriod>;
  const findPeriodMock =
    findScoringPeriodForDate as MockedFunction<typeof findScoringPeriodForDate>;

  beforeEach(() => {
    vi.resetAllMocks();
    resolveDateMock.mockImplementation(async (_game, _year, period) =>
      `2026-04-${String(period - 2).padStart(2, '0')}`
    );
    findPeriodMock.mockResolvedValue(null);
  });

  it('derives daily scoring membership from matchup-score schedule keys', () => {
    expect(parseMatchupScoringPeriods([
      {
        matchupPeriodId: 3,
        home: { pointsByScoringPeriod: { 15: 1, 16: 2 } },
        away: { pointsByScoringPeriod: { 15: 3, 16: 4 } },
      },
      {
        matchupPeriodId: 4,
        home: { pointsByScoringPeriod: { 17: 1, 18: 2 } },
      },
    ])).toEqual({
      3: [15, 16],
      4: [17, 18],
    });
    expect(() => parseMatchupScoringPeriods([
      { matchupPeriodId: 3, home: { pointsByScoringPeriod: { 15: 1, 16: 2 } } },
      { matchupPeriodId: 4, home: { pointsByScoringPeriod: { 16: 1, 17: 2 } } },
    ]))
      .toThrow('belonged to multiple matchup periods');
    expect(() => parseMatchupScoringPeriods([
      { matchupPeriodId: 3, home: { pointsByScoringPeriod: { invalid: 1 } } },
    ]))
      .toThrow('invalid scoring period');
  });

  it('clips the current daily matchup at the current scoring period', async () => {
    const window = await resolveEspnTransactionWindow({
      gameId: 'flb',
      seasonYear: 2026,
      sport: 'baseball',
      context: {
        ...dailyContext,
        matchupPeriods: {
          ...dailyContext.matchupPeriods,
          3: [20, 21, 22, 23, 24, 25, 26, 27],
        },
      },
      requestedWeek: 3,
    });

    expect(window.matchupPeriodIds).toEqual([3]);
    expect(window.scoringPeriodIds).toEqual([20, 21, 22, 23, 24, 25, 26]);
    expect(window.normalization).toBe('none');
    expect(window.endDate).toBe('2026-04-24');
  });

  it('normalizes a legacy scoring-period selector only when the direct matchup is wholly future', async () => {
    const window = await resolveEspnTransactionWindow({
      gameId: 'flb',
      seasonYear: 2026,
      sport: 'baseball',
      context: dailyContext,
      requestedWeek: 26,
    });

    expect(window.requestedWeek).toBe(26);
    expect(window.matchupPeriodIds).toEqual([3]);
    expect(window.scoringPeriodIds).toEqual([20, 21, 22, 23, 24, 25, 26]);
    expect(window.normalization).toBe('legacy_scoring_period_to_matchup');
  });

  it('rejects a scheduled future matchup instead of reinterpreting it as a scoring day', async () => {
    await expect(resolveEspnTransactionWindow({
      gameId: 'flb',
      seasonYear: 2026,
      sport: 'baseball',
      context: dailyContext,
      requestedWeek: 4,
    })).rejects.toThrow('exists in the ESPN schedule but has not begun');
  });

  it('uses complete current and previous matchup spans for the default window', async () => {
    const window = await resolveEspnTransactionWindow({
      gameId: 'flb',
      seasonYear: 2026,
      sport: 'baseball',
      context: dailyContext,
    });

    expect(window.mode).toBe('recent_two_weeks');
    expect(window.matchupPeriodIds).toEqual([3, 2]);
    expect(window.scoringPeriodIds).toEqual([
      13, 14, 15, 16, 17, 18, 19,
      20, 21, 22, 23, 24, 25, 26,
    ]);
  });

  it('fails closed when the score schedule cannot prove the previous matchup span', async () => {
    await expect(resolveEspnTransactionWindow({
      gameId: 'flb',
      seasonYear: 2026,
      sport: 'baseball',
      context: {
        ...dailyContext,
        matchupPeriods: { 3: dailyContext.matchupPeriods[3] },
      },
    })).rejects.toThrow('no scoring periods for matchup period 2');
  });

  it('gives a usable direct matchup precedence over the compatibility interpretation', async () => {
    const context: EspnLeagueContext = {
      ...dailyContext,
      scoringPeriodId: 23,
      currentMatchupPeriod: 3,
      matchupPeriods: {
        1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        2: [13, 14, 15, 16, 17, 18, 19],
        3: [20, 21, 22, 23, 24, 25, 26],
      },
    };
    const window = await resolveEspnTransactionWindow({
      gameId: 'flb',
      seasonYear: 2026,
      sport: 'baseball',
      context,
      requestedWeek: 2,
    });

    expect(window.matchupPeriodIds).toEqual([2]);
    expect(window.scoringPeriodIds).toEqual([13, 14, 15, 16, 17, 18, 19]);
    expect(window.normalization).toBe('none');
  });

  it('preserves ESPN’s full fourteen-day All-Star matchup span', async () => {
    const context: EspnLeagueContext = {
      scoringPeriodId: 127,
      currentMatchupPeriod: 17,
      matchupPeriods: {
        15: [104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117],
        16: [118, 119, 120, 121, 122, 123, 124],
        17: [125, 126, 127],
      },
      scheduledMatchupPeriodIds: [15, 16, 17, 18],
      teams: {},
    };
    const window = await resolveEspnTransactionWindow({
      gameId: 'flb',
      seasonYear: 2026,
      sport: 'baseball',
      context,
      requestedWeek: 15,
    });

    expect(window.matchupPeriodIds).toEqual([15]);
    expect(window.scoringPeriodIds).toEqual([
      104, 105, 106, 107, 108, 109, 110,
      111, 112, 113, 114, 115, 116, 117,
    ]);
    expect(window.normalization).toBe('none');
  });

  it('labels an omitted selector in matchup period zero as preseason', async () => {
    const window = await resolveEspnTransactionWindow({
      gameId: 'flb',
      seasonYear: 2026,
      sport: 'baseball',
      context: {
        scoringPeriodId: 0,
        currentMatchupPeriod: 0,
        matchupPeriods: {},
        scheduledMatchupPeriodIds: [0, 1],
        teams: {},
      },
    });

    expect(window.mode).toBe('preseason');
    expect(window.matchupPeriodIds).toEqual([0]);
    expect(window.scoringPeriodIds).toEqual([0]);
  });

  it('accepts a daily preseason league context when ESPN omits the score schedule', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        scoringPeriodId: 0,
        currentMatchupPeriod: 0,
        teams: [],
      }), { status: 200 }),
    );

    const context = await getEspnLeagueContext(
      'flb',
      '30201',
      2026,
      credentials,
    );

    expect(context).toMatchObject({
      scoringPeriodId: 0,
      currentMatchupPeriod: 0,
      matchupPeriods: {},
      scheduledMatchupPeriodIds: [],
    });
    fetchMock.mockRestore();
  });

  it('keeps the dormant structured normalizer on the public matchup window', () => {
    const rows = normalizeMTransactions2([{
      id: 7,
      type: 'FREEAGENT',
      status: 'EXECUTED',
      scoringPeriodId: 25,
      processDate: Date.parse('2026-04-23T16:00:00Z'),
      items: [{ type: 'ADD', playerId: 99, toTeamId: 1 }],
    }], dailyWindow());

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      week: 4,
      provider_scoring_period_id: 25,
    });
  });

  it('omits and counts rows whose message and topic scope evidence conflicts', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        topics: [{
          id: 1,
          date: Date.parse('2026-04-23T16:00:00Z'),
          matchupPeriodId: 4,
          scoringPeriodId: 25,
          messages: [{
            id: 10,
            messageTypeId: 178,
            targetId: 99,
            to: 1,
            matchupPeriodId: 3,
            scoringPeriodId: 25,
          }],
        }],
      }), { status: 200 }),
    );

    const result = await fetchEspnTransactionsByWindow(
      'flb',
      '30201',
      2026,
      'baseball',
      credentials,
      dailyWindow(),
      Date.now() + 5000,
    );

    expect(result.transactions).toEqual([]);
    expect(result.omittedConflictingRows).toBe(1);
    fetchMock.mockRestore();
  });

  it('does not admit an unscoped row merely because the default window is broad', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        topics: [{
          id: 1,
          date: Date.parse('2026-04-23T16:00:00Z'),
          messages: [{
            id: 10,
            messageTypeId: 178,
            targetId: 99,
            to: 1,
          }],
        }],
      }), { status: 200 }),
    );

    const result = await fetchEspnTransactionsByWindow(
      'flb',
      '30201',
      2026,
      'baseball',
      credentials,
      dailyWindow({ mode: 'recent_two_weeks', requestedWeek: null }),
      Date.now() + 5000,
    );

    expect(result.transactions).toEqual([]);
    expect(result.omittedUnscopedRows).toBe(1);
    expect(result.coverageIncomplete).toBe(false);
    fetchMock.mockRestore();
  });

  it('omits a trade that crosses the requested window without calling it a conflict', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        topics: [{
          id: 1,
          date: Date.parse('2026-04-23T16:00:00Z'),
          messages: [
            {
              id: 10,
              messageTypeId: 244,
              targetId: 99,
              from: 1,
              to: 2,
              matchupPeriodId: 4,
            },
            {
              id: 11,
              messageTypeId: 244,
              targetId: 100,
              from: 2,
              to: 1,
              matchupPeriodId: 5,
            },
          ],
        }],
      }), { status: 200 }),
    );

    const result = await fetchEspnTransactionsByWindow(
      'flb',
      '30201',
      2026,
      'baseball',
      credentials,
      dailyWindow(),
      Date.now() + 5000,
    );

    expect(result.transactions).toEqual([]);
    expect(result.omittedUnscopedRows).toBe(0);
    expect(result.omittedConflictingRows).toBe(0);
    fetchMock.mockRestore();
  });

  it('marks coverage incomplete when eight full pages cannot prove the start boundary', async () => {
    const topics = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      date: Date.parse('2026-04-24T16:00:00Z'),
      scoringPeriodId: 99,
      messages: [{
        id: index + 100,
        messageTypeId: 178,
        targetId: index + 1000,
        to: 1,
      }],
    }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ topics }), { status: 200 })
    );

    const result = await fetchEspnTransactionsByWindow(
      'flb',
      '30201',
      2026,
      'baseball',
      credentials,
      dailyWindow(),
      Date.now() + 5000,
    );

    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(result.transactions).toEqual([]);
    expect(result.coverageIncomplete).toBe(true);
    fetchMock.mockRestore();
  });

  it('rejects structured-only filters while the activity feed is authoritative', async () => {
    await expect(executeEspnTransactionOperation({
      gameId: 'flb',
      leagueId: '30201',
      seasonYear: 2026,
      sport: 'baseball',
      credentials,
      type: 'failed_bid',
      getPositionName: String,
      getProTeamAbbrev: String,
    })).rejects.toThrow('ESPN_TRANSACTION_TYPE_UNAVAILABLE');
  });
});
