import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { getLeagueTeams } from '../v3/get-league-teams';
import { EspnAuthenticationFailed, EspnApiError, EspnCredentialsRequired } from '../espn-types';

// Mock global fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('getLeagueTeams', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('throws EspnCredentialsRequired when cookies are missing', async () => {
    await expect(getLeagueTeams('', '', '12345', 2025, 'ffl'))
      .rejects.toBeInstanceOf(EspnCredentialsRequired);
  });

  it('throws Error when leagueId is missing', async () => {
    await expect(getLeagueTeams('{swid}', 's2token', '', 2025, 'ffl'))
      .rejects.toThrow('League ID is required');
  });

  it('throws EspnAuthenticationFailed on 401 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);

    await expect(getLeagueTeams('{swid}', 's2token', '12345', 2025, 'ffl'))
      .rejects.toBeInstanceOf(EspnAuthenticationFailed);
  });

  it('throws EspnAuthenticationFailed on 403 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    } as Response);

    await expect(getLeagueTeams('{swid}', 's2token', '12345', 2025, 'ffl'))
      .rejects.toBeInstanceOf(EspnAuthenticationFailed);
  });

  it('throws EspnApiError on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    await expect(getLeagueTeams('{swid}', 's2token', '12345', 2025, 'ffl'))
      .rejects.toBeInstanceOf(EspnApiError);
  });

  it('returns empty array when no teams in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ teams: null }),
    } as Response);

    const teams = await getLeagueTeams('{swid}', 's2token', '12345', 2025, 'ffl');
    expect(teams).toEqual([]);
  });

  it('returns parsed team data on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        teams: [
          { id: 1, name: 'Team One' },
          { id: 2, location: 'Chicago', nickname: 'Bears' },
          { id: 3 }, // No name - should use fallback
        ],
      }),
    } as Response);

    const teams = await getLeagueTeams('{swid}', 's2token', '12345', 2025, 'ffl');

    expect(teams).toEqual([
      { teamId: '1', teamName: 'Team One' },
      { teamId: '2', teamName: 'Chicago Bears' },
      { teamId: '3', teamName: 'Team 3' },
    ]);
  });

  it('constructs correct ESPN API URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ teams: [] }),
    } as Response);

    await getLeagueTeams('{test-swid}', 's2-token', '98765', 2024, 'flb');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2024/segments/0/leagues/98765?view=mStandings&view=mTeam',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Cookie': 'SWID={test-swid}; espn_s2=s2-token',
          'X-Fantasy-Source': 'kona',
          'X-Fantasy-Platform': 'kona-web-2.0.0',
        }),
      })
    );
  });
});

describe('historical membership validation integration', () => {
  /**
   * These tests verify the teamId validation logic that discoverHistoricalSeasons
   * uses after calling getLeagueTeams. We test getLeagueTeams + the validation
   * logic together.
   */

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('skips historical season when teamId is not in team list', async () => {
    // Mock ESPN to return teams that don't include user's teamId (5)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        teams: [
          { id: 1, name: 'Other Team 1' },
          { id: 2, name: 'Other Team 2' },
          // Note: teamId 5 is NOT in this list
        ],
      }),
    } as Response);

    const teams = await getLeagueTeams('{swid}', 's2', '12345', 2024, 'ffl');
    
    // Simulate what discoverHistoricalSeasons does
    const userTeamId = 5;
    const hasTeam = teams.some(t => t.teamId === String(userTeamId));
    
    // Should NOT find team - season should be skipped
    expect(hasTeam).toBe(false);
  });

  it('adds historical season when teamId is in team list', async () => {
    // Mock ESPN to return teams that include user's teamId (5)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        teams: [
          { id: 1, name: 'Other Team' },
          { id: 5, name: 'User Team' }, // User's teamId IS in this list
          { id: 10, name: 'Another Team' },
        ],
      }),
    } as Response);

    const teams = await getLeagueTeams('{swid}', 's2', '12345', 2024, 'ffl');
    
    const userTeamId = 5;
    const hasTeam = teams.some(t => t.teamId === String(userTeamId));
    
    // Should find team - season should be added
    expect(hasTeam).toBe(true);
  });

  it('handles numeric teamId comparison correctly (number vs string)', async () => {
    // ESPN returns id as number, getLeagueTeams converts to string
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        teams: [{ id: 42, name: 'Team 42' }],
      }),
    } as Response);

    const teams = await getLeagueTeams('{swid}', 's2', '12345', 2024, 'ffl');
    
    // discoverHistoricalSeasons stores league.teamId as number, 
    // but getLeagueTeams returns teamId as string - must convert for comparison
    const numericTeamId = 42;
    const hasTeam = teams.some(t => t.teamId === String(numericTeamId));
    
    expect(hasTeam).toBe(true);
  });
});

