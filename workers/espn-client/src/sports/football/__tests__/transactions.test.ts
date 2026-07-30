import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import { getCredentials } from '../../../shared/auth';
import { executeEspnTransactionOperation } from '../../../shared/espn-transactions';
import { getCurrentSeasonYear, withSeasonContext } from '../../../shared/season';

const SEASON_YEAR = getCurrentSeasonYear('football');

function makeParams(overrides: Partial<ToolParams> = {}) {
  return withSeasonContext({
    sport: 'football',
    league_id: '123',
    season_year: SEASON_YEAR,
    ...overrides,
  });
}

vi.mock('../../../shared/auth', () => ({
  getCredentials: vi.fn(),
}));

vi.mock('../../../shared/espn-transactions', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/espn-transactions')>(
    '../../../shared/espn-transactions',
  );
  return {
    assertTransactionsSeasonSupported: actual.assertTransactionsSeasonSupported,
    executeEspnTransactionOperation: vi.fn(),
  };
});

describe('football get_transactions handler', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const executeMock =
    executeEspnTransactionOperation as MockedFunction<typeof executeEspnTransactionOperation>;

  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    executeMock.mockResolvedValue({
      window: {
        mode: 'recent_two_weeks',
        unit: 'matchup_period',
        requested_week: null,
        normalization: 'none',
        weeks: [10, 9],
        provider_scoring_period_ids: [10, 9],
        start_date: null,
        end_date: null,
        date_bounds_kind: 'unavailable',
        timezone: 'America/New_York',
      },
      source: 'activity_feed',
      limitations: {
        structured_details_incomplete: true,
      },
      transactions: [],
      teams: { '1': 'Team One' },
      truncated: false,
    });
  });

  it('delegates the full matchup-window contract to the shared operation', async () => {
    const result = await footballHandlers.get_transactions(
      {} as never,
      makeParams({ week: 7, type: 'trade', count: 3 }),
      'Bearer x',
      'cid-1',
    );

    expect(result.success).toBe(true);
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      gameId: 'ffl',
      leagueId: '123',
      seasonYear: SEASON_YEAR,
      sport: 'football',
      requestedWeek: 7,
      type: 'trade',
      count: 3,
    }));
    if (!result.success) return;
    expect(result.data).toMatchObject({
      platform: 'espn',
      sport: 'football',
      league_id: '123',
      source: 'activity_feed',
      count: 0,
    });
  });

  it('returns a credentials error before executing the provider operation', async () => {
    getCredentialsMock.mockResolvedValue(null);
    const result = await footballHandlers.get_transactions(
      {} as never,
      makeParams(),
      'Bearer x',
      'cid-2',
    );

    expect(result.success).toBe(false);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('rejects prior seasons before calling ESPN', async () => {
    const result = await footballHandlers.get_transactions(
      {} as never,
      makeParams({ season_year: SEASON_YEAR - 1 }),
      'Bearer x',
      'cid-3',
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('ESPN_SEASON_NOT_SUPPORTED');
    expect(getCredentialsMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });
});
