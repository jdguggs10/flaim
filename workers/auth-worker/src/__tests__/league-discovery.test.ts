import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
vi.mock('../v3/get-league-info', () => ({
  getLeagueInfo: vi.fn(),
}));
vi.mock('../v3/get-league-teams', () => ({
  getLeagueTeams: vi.fn(),
}));

import {
  discoverLeaguesV3,
  discoverAndSaveLeagues,
} from '../v3/league-discovery';
import { EspnCredentialsRequired, AutomaticLeagueDiscoveryFailed } from '../espn-types';
import { getLeagueInfo } from '../v3/get-league-info';
import { getLeagueTeams } from '../v3/get-league-teams';

// Mock global fetch
const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
const mockGetLeagueInfo = vi.mocked(getLeagueInfo);
const mockGetLeagueTeams = vi.mocked(getLeagueTeams);

describe('discoverLeaguesV3', () => {
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockReset();
    mockGetLeagueInfo.mockReset();
    mockGetLeagueTeams.mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('throws EspnCredentialsRequired when cookies are missing', async () => {
    await expect(discoverLeaguesV3('', '')).rejects.toBeInstanceOf(
      EspnCredentialsRequired
    );
  });

  it('normalizes SWID and sends Fan API headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        preferences: [
          {
            id: 'pref-1',
            type: { code: 'fantasy' },
            metaData: {
              entry: {
                entryId: 8,
                gameId: 1,
                seasonId: 2025,
                entryMetadata: { teamName: 'Test Team' },
                groups: [{ groupId: 12345, groupName: 'Test League' }],
              },
            },
          },
        ],
      }),
    } as Response);

    await discoverLeaguesV3('BFA3386F-9501-4F4A-88C7-C56D6BB86C11', 's2token');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://fan.api.espn.com/apis/v2/fans/%7BBFA3386F-9501-4F4A-88C7-C56D6BB86C11%7D?displayEvents=true',
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'SWID={BFA3386F-9501-4F4A-88C7-C56D6BB86C11}; espn_s2=s2token',
          'x-p13n-swid': 'BFA3386F-9501-4F4A-88C7-C56D6BB86C11',
          'X-Personalization-Source': 'ESPN.com - FAM',
        }),
      })
    );
  });

  it('throws AutomaticLeagueDiscoveryFailed when no fantasy leagues found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ preferences: [] }),
    } as Response);

    await expect(discoverLeaguesV3('{BFA3386F-9501-4F4A-88C7-C56D6BB86C11}', 's2token'))
      .rejects.toBeInstanceOf(AutomaticLeagueDiscoveryFailed);
  });
});

describe('discoverAndSaveLeagues', () => {
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockReset();
    mockGetLeagueInfo.mockReset();
    mockGetLeagueTeams.mockReset();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('stores historical seasons with the season-specific team name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        preferences: [
          {
            id: 'pref-1',
            type: { code: 'fantasy' },
            metaData: {
              entry: {
                entryId: 8,
                gameId: 1,
                seasonId: 2025,
                entryMetadata: { teamName: 'Doubs on my Chubb' },
                groups: [{ groupId: 12345, groupName: 'Test League' }],
              },
            },
          },
        ],
      }),
    } as Response);

    mockGetLeagueInfo
      .mockResolvedValueOnce({
        status: { previousSeasons: [2024, 2023] },
      } as any)
      .mockResolvedValueOnce({ leagueName: 'Test League 2024' } as any)
      .mockResolvedValueOnce({ leagueName: 'Test League 2023' } as any);

    mockGetLeagueTeams
      .mockResolvedValueOnce([{ teamId: '8', teamName: 'Love Hurts 2024' }])
      .mockResolvedValueOnce([{ teamId: '8', teamName: 'Lamb of God 2023' }]);

    const storage = {
      leagueExists: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false),
      addLeague: vi.fn().mockResolvedValue({ success: true }),
      updateLeague: vi.fn().mockResolvedValue(true),
    } as any;

    await discoverAndSaveLeagues('user_123', '{swid}', 's2token', storage);

    expect(storage.addLeague).toHaveBeenCalledWith('user_123', expect.objectContaining({
      leagueId: '12345',
      seasonYear: 2024,
      teamId: '8',
      teamName: 'Love Hurts 2024',
    }));
    expect(storage.addLeague).toHaveBeenCalledWith('user_123', expect.objectContaining({
      leagueId: '12345',
      seasonYear: 2023,
      teamId: '8',
      teamName: 'Lamb of God 2023',
    }));
  });

  it('repairs existing historical rows with the season-specific team name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        preferences: [
          {
            id: 'pref-1',
            type: { code: 'fantasy' },
            metaData: {
              entry: {
                entryId: 8,
                gameId: 1,
                seasonId: 2025,
                entryMetadata: { teamName: 'Doubs on my Chubb' },
                groups: [{ groupId: 12345, groupName: 'Test League' }],
              },
            },
          },
        ],
      }),
    } as Response);

    mockGetLeagueInfo.mockResolvedValueOnce({
      status: { previousSeasons: [2024] },
    } as any);

    mockGetLeagueTeams.mockResolvedValueOnce([
      { teamId: '8', teamName: 'Old Team Name 2024' },
    ]);

    const storage = {
      leagueExists: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true),
      addLeague: vi.fn().mockResolvedValue({ success: true }),
      updateLeague: vi.fn().mockResolvedValue(true),
    } as any;

    await discoverAndSaveLeagues('user_123', '{swid}', 's2token', storage);

    expect(storage.updateLeague).toHaveBeenCalledWith(
      'user_123',
      '12345',
      'football',
      2024,
      expect.objectContaining({
        teamId: '8',
        teamName: 'Old Team Name 2024',
      })
    );
  });

  it('converts canonical historical basketball seasons back to ESPN-native years for ESPN calls', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        preferences: [
          {
            id: 'pref-1',
            type: { code: 'fantasy' },
            metaData: {
              entry: {
                entryId: 8,
                gameId: 3,
                seasonId: 2026,
                entryMetadata: { teamName: 'Buckets' },
                groups: [{ groupId: 54321, groupName: 'Dynasty Hoops' }],
              },
            },
          },
        ],
      }),
    } as Response);

    mockGetLeagueInfo
      .mockResolvedValueOnce({
        status: { previousSeasons: [2024] },
      } as any)
      .mockResolvedValueOnce({ leagueName: 'Dynasty Hoops 2024-25' } as any);

    mockGetLeagueTeams.mockResolvedValueOnce([
      { teamId: '8', teamName: 'Buckets 2024-25' },
    ]);

    const storage = {
      leagueExists: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false),
      addLeague: vi.fn().mockResolvedValue({ success: true }),
      updateLeague: vi.fn().mockResolvedValue(true),
    } as any;

    await discoverAndSaveLeagues('user_123', '{swid}', 's2token', storage);

    expect(mockGetLeagueTeams).toHaveBeenCalledWith('{swid}', 's2token', '54321', 2025, 'fba');
    expect(mockGetLeagueInfo).toHaveBeenNthCalledWith(2, '{swid}', 's2token', '54321', 2025, 'fba');
    expect(storage.addLeague).toHaveBeenCalledWith('user_123', expect.objectContaining({
      leagueId: '54321',
      sport: 'basketball',
      seasonYear: 2024,
      teamId: '8',
      teamName: 'Buckets 2024-25',
    }));
  });
});
