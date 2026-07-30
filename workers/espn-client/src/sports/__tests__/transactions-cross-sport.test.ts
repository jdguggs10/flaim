import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../baseball/handlers';
import { basketballHandlers } from '../basketball/handlers';
import { hockeyHandlers } from '../hockey/handlers';
import { getCredentials } from '../../shared/auth';
import { executeEspnTransactionOperation } from '../../shared/espn-transactions';
import { getCurrentSeasonYear, withSeasonContext } from '../../shared/season';
import type { SeasonSport } from '@flaim/worker-shared';

vi.mock('../../shared/auth', () => ({
  getCredentials: vi.fn(),
}));

vi.mock('../../shared/espn-transactions', async () => {
  const actual = await vi.importActual<typeof import('../../shared/espn-transactions')>(
    '../../shared/espn-transactions',
  );
  return {
    assertTransactionsSeasonSupported: actual.assertTransactionsSeasonSupported,
    executeEspnTransactionOperation: vi.fn(),
  };
});

const cases = [
  ['baseball', 'flb', baseballHandlers],
  ['basketball', 'fba', basketballHandlers],
  ['hockey', 'fhl', hockeyHandlers],
] as const;

describe('ESPN daily-sport get_transactions handlers', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const executeMock =
    executeEspnTransactionOperation as MockedFunction<typeof executeEspnTransactionOperation>;

  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    executeMock.mockResolvedValue({
      window: {
        mode: 'explicit_week',
        unit: 'matchup_period',
        requested_week: 4,
        normalization: 'none',
        weeks: [4],
        provider_scoring_period_ids: [22, 23, 24, 25, 26, 27, 28],
        start_date: '2026-04-20',
        end_date: '2026-04-26',
        date_bounds_kind: 'exact_contiguous',
        timezone: 'America/New_York',
      },
      source: 'activity_feed',
      limitations: { structured_details_incomplete: true },
      transactions: [],
      teams: {},
      truncated: false,
    });
  });

  it.each(cases)('%s passes matchup selectors to the shared operation', async (
    sport,
    gameId,
    handlers,
  ) => {
    const seasonYear = getCurrentSeasonYear(sport as SeasonSport);
    const params = withSeasonContext({
      sport,
      league_id: '123',
      season_year: seasonYear,
      week: 4,
    });
    const result = await handlers.get_transactions(
      {} as never,
      params,
      'Bearer x',
      `cid-${sport}`,
    );

    expect(result.success).toBe(true);
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      gameId,
      leagueId: '123',
      seasonYear: expect.any(Number),
      sport,
      requestedWeek: 4,
    }));
    if (!result.success) return;
    expect(result.data).toMatchObject({
      platform: 'espn',
      sport,
      source: 'activity_feed',
      count: 0,
    });
  });

  it.each(cases)('%s requires ESPN credentials', async (sport, _gameId, handlers) => {
    getCredentialsMock.mockResolvedValue(null);
    const params = withSeasonContext({
      sport,
      league_id: '123',
      season_year: getCurrentSeasonYear(sport as SeasonSport),
    });
    const result = await handlers.get_transactions({} as never, params, 'Bearer x');

    expect(result.success).toBe(false);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
