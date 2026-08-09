import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../baseball/handlers';
import { basketballHandlers } from '../basketball/handlers';
import { footballHandlers } from '../football/handlers';
import { hockeyHandlers } from '../hockey/handlers';
import type { HandlerToolParams, Sport, ToolParams } from '../../types';
import { getCredentials } from '../../shared/auth';
import { espnFetch } from '../../shared/espn-api';
import { withSeasonContext } from '../../shared/season';

vi.mock('../../shared/auth', () => ({
  getCredentials: vi.fn(),
}));

vi.mock('../../shared/espn-api', async () => {
  const actual = await vi.importActual('../../shared/espn-api') as Record<string, unknown>;
  return {
    ...actual,
    espnFetch: vi.fn(),
  };
});

const dailyScenarios = [
  { label: 'baseball', sport: 'baseball', handlers: baseballHandlers },
  { label: 'basketball', sport: 'basketball', handlers: basketballHandlers },
  { label: 'hockey', sport: 'hockey', handlers: hockeyHandlers },
] as const;

const TRUE_CURRENT_SCORING_PERIOD = 116;

function makeParams(sport: Sport, overrides: Partial<ToolParams> = {}): HandlerToolParams {
  return withSeasonContext({
    sport,
    league_id: '123',
    season_year: 2024,
    ...overrides,
  });
}

// Mirrors ESPN's echo behavior: a pinned scoringPeriodId in the request comes back in the
// payload's scoringPeriodId field; otherwise the league's true current period is returned.
function matchupResponse(path: string): Response {
  const pinned = path.match(/[?&]scoringPeriodId=(\d+)/);
  return new Response(JSON.stringify({
    scoringPeriodId: pinned ? Number(pinned[1]) : TRUE_CURRENT_SCORING_PERIOD,
    currentMatchupPeriod: 16,
    teams: [
      { id: 1, name: 'Team 1' },
      { id: 2, name: 'Team 2' },
    ],
    schedule: [
      { matchupPeriodId: 15, winner: 'HOME', home: { teamId: 1, totalPoints: 10 }, away: { teamId: 2, totalPoints: 8 } },
      { matchupPeriodId: 16, winner: 'UNDECIDED', home: { teamId: 2, totalPoints: 3 }, away: { teamId: 1, totalPoints: 4 } },
    ],
    settings: { scoringSettings: { scoringType: 'H2H_POINTS' } },
  }), { status: 200 });
}

const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

describe('espn get_matchups scoring-period metadata contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockImplementation(async (path: string) => matchupResponse(path));
  });

  describe.each(dailyScenarios)('$label (daily)', ({ sport, handlers }) => {
    it('leaves currentScoringPeriod unaffected by an explicit week', async () => {
      const result = await handlers.get_matchups({} as never, makeParams(sport, { week: 15 }), 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const path = espnFetchMock.mock.calls[0][0] as string;
      expect(path).toContain('matchupPeriodId=15');
      expect(path).not.toContain('scoringPeriodId');
      const data = result.data as Record<string, unknown>;
      expect(data.currentScoringPeriod).toBe(TRUE_CURRENT_SCORING_PERIOD);
      expect(data.matchupPeriod).toBe(15);
      const matchups = data.matchups as Array<{ matchupPeriodId: number }>;
      expect(matchups).toHaveLength(1);
      expect(matchups[0].matchupPeriodId).toBe(15);
    });

    it('reports the true current scoring period when no week is requested', async () => {
      const result = await handlers.get_matchups({} as never, makeParams(sport), 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const path = espnFetchMock.mock.calls[0][0] as string;
      expect(path).not.toContain('scoringPeriodId');
      expect(path).not.toContain('matchupPeriodId');
      const data = result.data as Record<string, unknown>;
      expect(data.currentScoringPeriod).toBe(TRUE_CURRENT_SCORING_PERIOD);
      expect(data.matchupPeriod).toBe(16);
    });
  });

  describe('football (weekly)', () => {
    it('keeps the scoringPeriodId pin, where week and scoring period coincide', async () => {
      const result = await footballHandlers.get_matchups({} as never, makeParams('football', { week: 15 }), 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const path = espnFetchMock.mock.calls[0][0] as string;
      expect(path).toContain('scoringPeriodId=15');
      expect(path).toContain('matchupPeriodId=15');
      const data = result.data as Record<string, unknown>;
      expect(data.currentScoringPeriod).toBe(15);
      expect(data.matchupPeriod).toBe(15);
    });
  });
});
