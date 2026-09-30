import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeEspnTransactionOperation } from '../espn-transactions';
import { clearScoringPeriodAnchorCache } from '../scoring-period';

const credentials = { s2: 'token', swid: '{swid}' };
const leagueContext = {
  scoringPeriodId: 188,
  currentMatchupPeriod: 21,
  schedule: [
    {
      matchupPeriodId: 20,
      home: {
        pointsByScoringPeriod: Object.fromEntries(
          Array.from({ length: 7 }, (_, index) => [181 + index, 0]),
        ),
      },
    },
    {
      // ESPN can advance the league's current scoring period before adding a
      // corresponding score key. getEspnLeagueContext adds period 188 to this
      // current matchup after validating the schedule.
      matchupPeriodId: 21,
      home: { pointsByScoringPeriod: {} },
    },
  ],
  teams: [],
};

function eveningGame(date: string): { date: number } {
  return { date: Date.parse(`${date}T23:00:00Z`) };
}

function calendarBody(
  periods: Record<string, Array<{ date: number }>> = {
    '1': [eveningGame('2026-03-25')],
    '181': [eveningGame('2026-09-21')],
    '187': [eveningGame('2026-09-27')],
  },
): object {
  return {
    settings: { proTeams: [{ proGamesByScoringPeriod: periods }] },
  };
}

function response(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

interface FetchFixture {
  calendar?: object;
  structuredUnavailable?: boolean;
  activity?: object;
}

function installFetchFixture({
  calendar = calendarBody(),
  structuredUnavailable = false,
  activity = { topics: [] },
}: FetchFixture = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('view=mMatchupScore')) {
      return response(leagueContext);
    }
    if (url.includes('view=proTeamSchedules_wl')) {
      return response(calendar);
    }
    if (url.includes('view=mTransactions2')) {
      if (structuredUnavailable) {
        return new Response('structured unavailable', { status: 500 });
      }
      const scoringPeriodId = Number(new URL(url).searchParams.get('scoringPeriodId'));
      return response({
        transactions: scoringPeriodId === 188
          ? [{
              id: 1880,
              type: 'FREEAGENT',
              status: 'EXECUTED',
              teamId: 1,
              processDate: Date.parse('2026-09-28T16:00:00Z'),
              scoringPeriodId: 188,
              items: [],
            }]
          : [],
      });
    }
    if (url.includes('view=kona_league_communication')) {
      return response(activity);
    }
    if (url.includes('/players?scoringPeriodId=0&view=players_wl')) {
      return response([]);
    }
    throw new Error(`Unexpected ESPN test request: ${url}`);
  });
}

async function execute(requestedWeek?: number) {
  return executeEspnTransactionOperation({
    gameId: 'flb',
    leagueId: '123',
    seasonYear: 2026,
    sport: 'baseball',
    credentials,
    requestedWeek,
    getPositionName: String,
    getProTeamAbbrev: String,
  });
}

describe('ESPN transaction periods beyond the game calendar', () => {
  beforeEach(() => {
    clearScoringPeriodAnchorCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['the default current-and-previous window', undefined, [21, 20], 181, '2026-09-21'],
    ['an explicit current matchup', 21, [21], 188, null],
  ])('preserves provider period 188 for %s without inventing its date', async (
    _label,
    requestedWeek,
    expectedWeeks,
    expectedFirstPeriod,
    expectedStartDate,
  ) => {
    installFetchFixture();

    const result = await execute(requestedWeek);

    expect(result.source).toBe('mTransactions2');
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      transaction_id: '1880',
      week: 21,
      provider_scoring_period_id: 188,
    });
    expect(result.window.weeks).toEqual(expectedWeeks);
    expect(result.window.provider_scoring_period_ids[0]).toBe(expectedFirstPeriod);
    expect(result.window.provider_scoring_period_ids.at(-1)).toBe(188);
    expect(result.window.start_date).toBe(expectedStartDate);
    expect(result.window.end_date).toBeNull();
    expect(result.window.date_bounds_kind).toBe('unavailable');
    expect(result.limitations.exact_date_bounds_unavailable).toBe(true);
  });

  it('keeps explicit period 188 activity but omits timestamp-only offseason rows', async () => {
    installFetchFixture({
      structuredUnavailable: true,
      activity: {
        topics: [{
          id: 1,
          date: Date.parse('2026-09-28T16:00:00Z'),
          messages: [
            {
              id: 10,
              messageTypeId: 178,
              targetId: 100,
              to: 1,
              scoringPeriodId: 188,
            },
            {
              id: 11,
              messageTypeId: 178,
              targetId: 101,
              to: 1,
            },
          ],
        }],
      },
    });

    const result = await execute(21);

    expect(result.source).toBe('activity_feed');
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      transaction_id: '10',
      week: 21,
      provider_scoring_period_id: 188,
    });
    expect(result.limitations).toMatchObject({
      structured_details_incomplete: true,
      omitted_unscoped_rows: 1,
      exact_date_bounds_unavailable: true,
    });
  });

  it('still fails closed when the season calendar invariant is invalid', async () => {
    installFetchFixture({
      calendar: calendarBody({
        '186': [eveningGame('2026-09-25')],
        '187': [eveningGame('2026-09-27')],
      }),
    });

    await expect(execute(21)).rejects.toThrow(
      /ESPN_INVALID_RESPONSE.*constant day-offset invariant/,
    );
  });
});
