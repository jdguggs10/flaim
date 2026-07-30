import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  executeEspnTransactionOperation,
  fetchEspnTransactionsByWindow,
  normalizeMTransactions2,
  parseMatchupPeriods,
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
  currentMatchupPeriod: 4,
  matchupPeriods: {
    1: [1, 2, 3, 4, 5, 6, 7],
    2: [8, 9, 10, 11, 12, 13, 14],
    3: [15, 16, 17, 18, 19, 20, 21],
    4: [22, 23, 24, 25, 26, 27, 28],
    26: [176, 177, 178, 179, 180, 181, 182],
  },
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

  it('parses a sanitized daily-sport matchup map and rejects ambiguous membership', () => {
    expect(parseMatchupPeriods({ 3: [15, 16], 4: [17, 18] })).toEqual({
      3: [15, 16],
      4: [17, 18],
    });
    expect(() => parseMatchupPeriods({ 3: [15, 16], 4: [16, 17] }))
      .toThrow('belonged to multiple matchup periods');
    expect(() => parseMatchupPeriods({ 3: [15, 15] }))
      .toThrow('repeated scoring period 15');
  });

  it('clips the current daily matchup at the current scoring period', async () => {
    const window = await resolveEspnTransactionWindow({
      gameId: 'flb',
      seasonYear: 2026,
      sport: 'baseball',
      context: dailyContext,
      requestedWeek: 4,
    });

    expect(window.matchupPeriodIds).toEqual([4]);
    expect(window.scoringPeriodIds).toEqual([22, 23, 24, 25, 26]);
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
    expect(window.matchupPeriodIds).toEqual([4]);
    expect(window.scoringPeriodIds).toEqual([22, 23, 24, 25, 26]);
    expect(window.normalization).toBe('legacy_scoring_period_to_matchup');
  });

  it('gives a usable direct matchup precedence over the compatibility interpretation', async () => {
    const context: EspnLeagueContext = {
      ...dailyContext,
      scoringPeriodId: 16,
      currentMatchupPeriod: 3,
      matchupPeriods: {
        1: [1, 2, 3, 4, 5, 6, 7],
        2: [8, 9, 10, 11, 12, 13, 14],
        3: [15, 16, 17, 18, 19, 20, 21],
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
    expect(window.scoringPeriodIds).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(window.normalization).toBe('none');
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
