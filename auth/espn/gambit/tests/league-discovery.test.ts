/**
 * Tests for ESPN League Discovery Service
 */

import { describe, it, expect, beforeEach, vi, MockedFunction } from 'vitest';
import { discoverLeagues, discoverLeaguesSafe, filterLeaguesBySport } from '../league-discovery.js';
import { AutomaticLeagueDiscoveryFailed, EspnCredentialsRequired, EspnAuthenticationFailed } from '../errors.js';
import { GambitLeague } from '../schema.js';

// Mock fetch globally
const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('ESPN League Discovery', () => {
  const validSwid = '{12345678-1234-1234-1234-123456789ABC}';
  const validS2 = 'AEBtestS2cookieValue123456789';
  
  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn(); // Mock console.log to reduce test noise
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  describe('discoverLeagues', () => {
    it('should successfully return leagues from dashboard', async () => {
      const mockLeagues = [
        {
          gameId: 'ffl',
          leagueId: '123456',
          leagueName: 'Test Football League',
          seasonId: 2024,
          teamId: 1,
          teamName: 'Test Team'
        },
        {
          gameId: 'flb',
          leagueId: '789012',
          leagueName: 'Test Baseball League', 
          seasonId: 2024,
          teamId: 2,
          teamName: 'Another Team'
        }
      ];

      const mockResponse = {
        fantasyDashboard: {
          leagues: mockLeagues
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      } as Response);

      const result = await discoverLeagues(validSwid, validS2);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        gameId: 'ffl',
        leagueId: '123456',
        leagueName: 'Test Football League',
        seasonId: 2024,
        teamId: 1,
        teamName: 'Test Team'
      });
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gambit-api.fantasy.espn.com/apis/v1/dashboards/espn-en?view=allon',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Cookie': `SWID=${validSwid}; espn_s2=${validS2}`
          })
        })
      );
    });

    it('should throw EspnCredentialsRequired when SWID is missing', async () => {
      await expect(discoverLeagues('', validS2))
        .rejects.toThrow(EspnCredentialsRequired);
    });

    it('should throw EspnCredentialsRequired when espn_s2 is missing', async () => {
      await expect(discoverLeagues(validSwid, ''))
        .rejects.toThrow(EspnCredentialsRequired);
    });

    it('should throw EspnAuthenticationFailed on 401 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      } as Response);

      await expect(discoverLeagues(validSwid, validS2))
        .rejects.toThrow(EspnAuthenticationFailed);
    });

    it('should throw EspnAuthenticationFailed on 403 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      } as Response);

      await expect(discoverLeagues(validSwid, validS2))
        .rejects.toThrow(EspnAuthenticationFailed);
    });

    it('should throw AutomaticLeagueDiscoveryFailed on 404 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as Response);

      await expect(discoverLeagues(validSwid, validS2))
        .rejects.toThrow(AutomaticLeagueDiscoveryFailed);
    });

    it('should throw AutomaticLeagueDiscoveryFailed when leagues array is empty', async () => {
      const mockResponse = {
        fantasyDashboard: {
          leagues: []
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      } as Response);

      await expect(discoverLeagues(validSwid, validS2))
        .rejects.toThrow(AutomaticLeagueDiscoveryFailed);
    });

    it('should throw AutomaticLeagueDiscoveryFailed when leagues is not an array', async () => {
      const mockResponse = {
        fantasyDashboard: {
          leagues: null
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      } as Response);

      await expect(discoverLeagues(validSwid, validS2))
        .rejects.toThrow(AutomaticLeagueDiscoveryFailed);
    });

    it('should handle partial league data gracefully', async () => {
      const mockLeagues = [
        {
          gameId: 'ffl',
          leagueId: '123456',
          leagueName: 'Complete League',
          seasonId: 2024,
          teamId: 1,
          teamName: 'Complete Team'
        },
        {
          gameId: 'flb',
          leagueId: '789012',
          // Missing leagueName - should be filtered out
          seasonId: 2024,
          teamId: 2,
          teamName: 'Incomplete Team'
        },
        {
          gameId: 'fba',
          leagueId: '345678',
          leagueName: 'Basketball League',
          seasonId: 2024,
          teamId: 3,
          teamName: 'Basketball Team'
        }
      ];

      const mockResponse = {
        fantasyDashboard: {
          leagues: mockLeagues
        }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      } as Response);

      const result = await discoverLeagues(validSwid, validS2);

      expect(result).toHaveLength(2); // Should filter out incomplete league
      expect(result.map(l => l.leagueId)).toEqual(['123456', '345678']);
    });

    it('should handle fetch network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(discoverLeagues(validSwid, validS2))
        .rejects.toThrow(AutomaticLeagueDiscoveryFailed);
    });
  });

  describe('discoverLeaguesSafe', () => {
    it('should return success result when discovery succeeds', async () => {
      const mockLeagues = [{
        gameId: 'ffl',
        leagueId: '123456',
        leagueName: 'Test League',
        seasonId: 2024,
        teamId: 1,
        teamName: 'Test Team'
      }];

      const mockResponse = {
        fantasyDashboard: { leagues: mockLeagues }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      } as Response);

      const result = await discoverLeaguesSafe(validSwid, validS2);

      expect(result.success).toBe(true);
      expect(result.leagues).toHaveLength(1);
      expect(result.error).toBeUndefined();
    });

    it('should return error result when discovery fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      } as Response);

      const result = await discoverLeaguesSafe(validSwid, validS2);

      expect(result.success).toBe(false);
      expect(result.leagues).toHaveLength(0);
      expect(result.error).toContain('ESPN authentication failed');
    });
  });

  describe('filterLeaguesBySport', () => {
    const testLeagues: GambitLeague[] = [
      {
        gameId: 'ffl',
        leagueId: '1',
        leagueName: 'Football League',
        seasonId: 2024,
        teamId: 1,
        teamName: 'Team 1'
      },
      {
        gameId: 'flb',
        leagueId: '2',
        leagueName: 'Baseball League',
        seasonId: 2024,
        teamId: 2,
        teamName: 'Team 2'
      },
      {
        gameId: 'ffl',
        leagueId: '3',
        leagueName: 'Another Football League',
        seasonId: 2024,
        teamId: 3,
        teamName: 'Team 3'
      }
    ];

    it('should filter leagues by football sport', () => {
      const result = filterLeaguesBySport(testLeagues, 'ffl');
      expect(result).toHaveLength(2);
      expect(result.every(l => l.gameId === 'ffl')).toBe(true);
    });

    it('should filter leagues by baseball sport', () => {
      const result = filterLeaguesBySport(testLeagues, 'flb');
      expect(result).toHaveLength(1);
      expect(result[0].leagueId).toBe('2');
    });

    it('should return empty array for non-existent sport', () => {
      const result = filterLeaguesBySport(testLeagues, 'fba');
      expect(result).toHaveLength(0);
    });
  });
});