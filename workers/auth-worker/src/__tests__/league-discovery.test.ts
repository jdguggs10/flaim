import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  discoverLeaguesV3,
} from '../v3/league-discovery';
import { EspnCredentialsRequired, AutomaticLeagueDiscoveryFailed } from '../espn-types';

// Mock global fetch
const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('discoverLeaguesV3', () => {
  beforeEach(() => {
    mockFetch.mockReset();
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
