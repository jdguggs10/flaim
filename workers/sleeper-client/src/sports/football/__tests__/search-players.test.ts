import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { Env, ToolParams } from '../../../types';
import { sleeperFetch } from '../../../shared/sleeper-api';
import { getSleeperPlayersIndex } from '../../../shared/sleeper-players-cache';

vi.mock('../../../shared/sleeper-api', () => ({
  sleeperFetch: vi.fn(),
  handleSleeperError: vi.fn((response: Response) => {
    throw new Error(`SLEEPER_API_ERROR: Sleeper returned ${response.status}`);
  }),
}));

vi.mock('../../../shared/sleeper-players-cache', () => ({
  getSleeperPlayersIndex: vi.fn(),
}));

describe('sleeper football targeted player availability', () => {
  const sleeperFetchMock = sleeperFetch as MockedFunction<typeof sleeperFetch>;
  const getPlayersIndexMock = getSleeperPlayersIndex as MockedFunction<typeof getSleeperPlayersIndex>;
  const playerId = '4046';

  // Three deliberately synthetic leagues prove request-local isolation
  // without publishing or depending on any user's live league data.
  const leagueFixtures = {
    'league-alpha': {
      rosters: [{ roster_id: 3, owner_id: 'owner-alpha', players: [playerId] }],
      users: [{ user_id: 'owner-alpha', display_name: 'Alpha Owner', metadata: { team_name: 'Alpha Team' } }],
    },
    'league-beta': {
      rosters: [{ roster_id: 6, owner_id: 'owner-beta', players: ['different-player'] }],
      users: [{ user_id: 'owner-beta', display_name: 'Beta Owner', metadata: { team_name: 'Beta Team' } }],
    },
    'league-gamma': {
      rosters: [{ roster_id: 8, owner_id: 'owner-gamma', players: [playerId] }],
      users: [{ user_id: 'owner-gamma', display_name: 'Gamma Owner', metadata: { team_name: 'Gamma Team' } }],
    },
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    getPlayersIndexMock.mockResolvedValue(new Map([
      [playerId, {
        player_id: playerId,
        full_name: 'Patrick Mahomes',
        position: 'QB',
        team: 'KC',
        active: true,
      }],
    ]));
    sleeperFetchMock.mockImplementation(async (path: string) => {
      const match = path.match(/^\/league\/([^/]+)\/(rosters|users)$/);
      if (!match) return new Response('not found', { status: 404 });
      const [, leagueId, resource] = match;
      const fixture = leagueFixtures[leagueId as keyof typeof leagueFixtures];
      if (!fixture) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(fixture[resource as 'rosters' | 'users']), { status: 200 });
    });
  });

  async function lookup(league_id: keyof typeof leagueFixtures) {
    const params: ToolParams = {
      sport: 'football',
      league_id,
      season_year: 2026,
      query: 'Patrick Mahomes',
      count: 10,
    };
    const result = await footballHandlers.get_players(
      { SLEEPER_PLAYERS_CACHE: {} as KVNamespace } as Env,
      params,
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    return (result.data as { players: Array<Record<string, unknown>> }).players[0];
  }

  it('independently verifies the same player in all three leagues without ownership bleed', async () => {
    const alpha = await lookup('league-alpha');
    const beta = await lookup('league-beta');
    const gamma = await lookup('league-gamma');

    expect(alpha).toMatchObject({
      id: playerId,
      availability_status: 'ROSTERED',
      league_status: 'ROSTERED',
      league_team_id: '3',
      league_team_name: 'Alpha Team',
      league_owner_name: 'Alpha Owner',
    });
    expect(beta).toMatchObject({
      id: playerId,
      availability_status: 'AVAILABLE',
      league_status: 'FREE_AGENT',
      league_team_id: null,
      league_team_name: null,
      league_owner_name: null,
    });
    expect(gamma).toMatchObject({
      id: playerId,
      availability_status: 'ROSTERED',
      league_status: 'ROSTERED',
      league_team_id: '8',
      league_team_name: 'Gamma Team',
      league_owner_name: 'Gamma Owner',
    });

    for (const leagueId of Object.keys(leagueFixtures)) {
      expect(sleeperFetchMock).toHaveBeenCalledWith(`/league/${leagueId}/rosters`);
      expect(sleeperFetchMock).toHaveBeenCalledWith(`/league/${leagueId}/users`);
    }
  });

  it('fails closed instead of claiming AVAILABLE when the selected league roster fetch fails', async () => {
    sleeperFetchMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/rosters')) return new Response('unavailable', { status: 503 });
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const result = await footballHandlers.get_players(
      { SLEEPER_PLAYERS_CACHE: {} as KVNamespace } as Env,
      {
        sport: 'football',
        league_id: 'league-alpha',
        season_year: 2026,
        query: 'Patrick Mahomes',
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('SLEEPER_API_ERROR');
  });
});
