import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YahooStorage } from '../yahoo-storage';

// Mock Supabase client
const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockUpsert = vi.fn();
const mockIs = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

describe('YahooStorage', () => {
  let storage: YahooStorage;

  beforeEach(() => {
    storage = new YahooStorage('https://example.supabase.co', 'test-key');

    // Reset all mocks
    vi.clearAllMocks();

    // Setup chain mocking
    mockFrom.mockReturnValue({
      insert: mockInsert,
      select: mockSelect,
      update: mockUpdate,
      delete: mockDelete,
      upsert: mockUpsert,
    });
    mockInsert.mockReturnValue({ select: mockSelect, error: null });
    mockSelect.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
    });
    mockEq.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      select: mockSelect,
      delete: mockDelete,
      is: mockIs,
    });
    mockUpdate.mockReturnValue({
      eq: mockEq,
      error: null,
    });
    mockDelete.mockReturnValue({
      eq: mockEq,
      error: null,
    });
    mockUpsert.mockReturnValue({
      select: mockSelect,
      error: null,
    });
    mockIs.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Platform OAuth State Tests
  // ===========================================================================

  describe('createPlatformOAuthState', () => {
    it('stores state in platform_oauth_states table', async () => {
      mockInsert.mockReturnValue({ error: null });

      await storage.createPlatformOAuthState({
        state: 'test-state-123',
        clerkUserId: 'user_abc123',
        platform: 'yahoo',
        redirectAfter: '/leagues',
      });

      expect(mockFrom).toHaveBeenCalledWith('platform_oauth_states');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'test-state-123',
          clerk_user_id: 'user_abc123',
          platform: 'yahoo',
          redirect_after: '/leagues',
        })
      );
    });

    it('sets expiration to 10 minutes by default', async () => {
      mockInsert.mockReturnValue({ error: null });

      const before = Date.now();
      await storage.createPlatformOAuthState({
        state: 'test-state',
        clerkUserId: 'user_abc',
        platform: 'yahoo',
      });
      const after = Date.now();

      const call = mockInsert.mock.calls[0][0];
      const expiresAt = new Date(call.expires_at).getTime();

      // Should be ~10 minutes from now (600 seconds)
      expect(expiresAt).toBeGreaterThanOrEqual(before + 600 * 1000 - 1000);
      expect(expiresAt).toBeLessThanOrEqual(after + 600 * 1000 + 1000);
    });

    it('throws on database error', async () => {
      mockInsert.mockReturnValue({ error: { message: 'DB error' } });

      await expect(
        storage.createPlatformOAuthState({
          state: 'test',
          clerkUserId: 'user',
          platform: 'yahoo',
        })
      ).rejects.toThrow('Failed to create platform OAuth state');
    });
  });

  describe('consumePlatformOAuthState', () => {
    it('returns state data for valid state', async () => {
      const futureDate = new Date(Date.now() + 5 * 60 * 1000); // 5 mins from now
      mockSingle.mockResolvedValue({
        data: {
          state: 'valid-state',
          clerk_user_id: 'user_123',
          platform: 'yahoo',
          redirect_after: '/dashboard',
          expires_at: futureDate.toISOString(),
        },
        error: null,
      });
      mockDelete.mockReturnValue({
        eq: mockEq,
        error: null,
      });

      const result = await storage.consumePlatformOAuthState('valid-state');

      expect(result).toEqual({
        clerkUserId: 'user_123',
        platform: 'yahoo',
        redirectAfter: '/dashboard',
      });
      expect(mockFrom).toHaveBeenCalledWith('platform_oauth_states');
      // Should delete the state after consuming
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns null for expired state', async () => {
      const pastDate = new Date(Date.now() - 5 * 60 * 1000); // 5 mins ago
      mockSingle.mockResolvedValue({
        data: {
          state: 'expired-state',
          clerk_user_id: 'user_123',
          platform: 'yahoo',
          expires_at: pastDate.toISOString(),
        },
        error: null,
      });
      mockDelete.mockReturnValue({
        eq: mockEq,
        error: null,
      });

      const result = await storage.consumePlatformOAuthState('expired-state');

      expect(result).toBeNull();
      // Should still delete the expired state
      expect(mockDelete).toHaveBeenCalled();
    });

    it('returns null for non-existent state', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'No rows' },
      });

      const result = await storage.consumePlatformOAuthState('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Yahoo Credentials Tests
  // ===========================================================================

  describe('saveYahooCredentials', () => {
    it('upserts credentials in yahoo_credentials table', async () => {
      mockUpsert.mockReturnValue({ error: null });

      await storage.saveYahooCredentials({
        clerkUserId: 'user_xyz',
        accessToken: 'yahoo-access-token',
        refreshToken: 'yahoo-refresh-token',
        expiresAt: new Date('2026-01-24T12:00:00Z'),
        yahooGuid: 'yahoo-user-guid',
      });

      expect(mockFrom).toHaveBeenCalledWith('yahoo_credentials');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          clerk_user_id: 'user_xyz',
          access_token: 'yahoo-access-token',
          refresh_token: 'yahoo-refresh-token',
          yahoo_guid: 'yahoo-user-guid',
        }),
        expect.objectContaining({ onConflict: 'clerk_user_id' })
      );
    });

    it('throws on database error', async () => {
      mockUpsert.mockReturnValue({ error: { message: 'Upsert failed' } });

      await expect(
        storage.saveYahooCredentials({
          clerkUserId: 'user',
          accessToken: 'token',
          refreshToken: 'refresh',
          expiresAt: new Date(),
        })
      ).rejects.toThrow('Failed to save Yahoo credentials');
    });
  });

  describe('getYahooCredentials', () => {
    it('returns credentials with needsRefresh=false when token is fresh', async () => {
      // Token expires in 30 minutes - well outside the 5-minute buffer
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      mockSingle.mockResolvedValue({
        data: {
          clerk_user_id: 'user_123',
          access_token: 'fresh-token',
          refresh_token: 'refresh-token',
          expires_at: expiresAt.toISOString(),
          yahoo_guid: 'guid-123',
        },
        error: null,
      });

      const result = await storage.getYahooCredentials('user_123');

      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe('fresh-token');
      expect(result?.needsRefresh).toBe(false);
    });

    it('returns credentials with needsRefresh=true when within 5-minute buffer', async () => {
      // Token expires in 3 minutes - within the 5-minute buffer
      const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
      mockSingle.mockResolvedValue({
        data: {
          clerk_user_id: 'user_123',
          access_token: 'expiring-token',
          refresh_token: 'refresh-token',
          expires_at: expiresAt.toISOString(),
          yahoo_guid: 'guid-123',
        },
        error: null,
      });

      const result = await storage.getYahooCredentials('user_123');

      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe('expiring-token');
      expect(result?.needsRefresh).toBe(true);
    });

    it('returns credentials with needsRefresh=true when token is expired', async () => {
      // Token already expired
      const expiresAt = new Date(Date.now() - 5 * 60 * 1000);
      mockSingle.mockResolvedValue({
        data: {
          clerk_user_id: 'user_123',
          access_token: 'expired-token',
          refresh_token: 'refresh-token',
          expires_at: expiresAt.toISOString(),
          yahoo_guid: null,
        },
        error: null,
      });

      const result = await storage.getYahooCredentials('user_123');

      expect(result).not.toBeNull();
      expect(result?.needsRefresh).toBe(true);
    });

    it('returns null when no credentials exist', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'No rows' },
      });

      const result = await storage.getYahooCredentials('nonexistent-user');

      expect(result).toBeNull();
    });
  });

  describe('updateYahooCredentials', () => {
    it('updates tokens after refresh', async () => {
      mockEq.mockReturnValue({ error: null });

      await storage.updateYahooCredentials('user_123', {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: new Date('2026-01-24T14:00:00Z'),
      });

      expect(mockFrom).toHaveBeenCalledWith('yahoo_credentials');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
        })
      );
    });
  });

  describe('deleteYahooCredentials', () => {
    it('deletes credentials for user', async () => {
      mockEq.mockReturnValue({ error: null });

      await storage.deleteYahooCredentials('user_123');

      expect(mockFrom).toHaveBeenCalledWith('yahoo_credentials');
      expect(mockDelete).toHaveBeenCalled();
      expect(mockEq).toHaveBeenCalledWith('clerk_user_id', 'user_123');
    });
  });

  describe('hasYahooCredentials', () => {
    it('returns true when credentials exist', async () => {
      mockSingle.mockResolvedValue({
        data: { clerk_user_id: 'user_123' },
        error: null,
      });

      const result = await storage.hasYahooCredentials('user_123');

      expect(result).toBe(true);
    });

    it('returns false when no credentials exist', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const result = await storage.hasYahooCredentials('nonexistent');

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Yahoo Leagues Tests
  // ===========================================================================

  describe('upsertYahooLeague', () => {
    it('upserts league in yahoo_leagues table', async () => {
      mockSelect.mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'uuid-123' },
          error: null,
        }),
      });
      mockUpsert.mockReturnValue({
        select: mockSelect,
        error: null,
      });

      const result = await storage.upsertYahooLeague({
        clerkUserId: 'user_123',
        sport: 'football',
        seasonYear: 2025,
        leagueKey: 'nfl.l.12345',
        leagueName: 'My Fantasy League',
        teamId: '3',
        teamKey: 'nfl.l.12345.t.3',
      });

      expect(mockFrom).toHaveBeenCalledWith('yahoo_leagues');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          clerk_user_id: 'user_123',
          sport: 'football',
          season_year: 2025,
          league_key: 'nfl.l.12345',
          league_name: 'My Fantasy League',
          team_id: '3',
          team_key: 'nfl.l.12345.t.3',
        }),
        expect.objectContaining({
          onConflict: 'clerk_user_id,league_key,season_year',
        })
      );
      expect(result).toBe('uuid-123');
    });
  });

  describe('getYahooLeagues', () => {
    it('returns leagues for user', async () => {
      mockEq.mockReturnValue({
        data: [
          {
            id: 'uuid-1',
            clerk_user_id: 'user_123',
            sport: 'football',
            season_year: 2025,
            league_key: 'nfl.l.12345',
            league_name: 'League One',
            team_id: '3',
            team_key: 'nfl.l.12345.t.3',
            is_default: true,
          },
          {
            id: 'uuid-2',
            clerk_user_id: 'user_123',
            sport: 'baseball',
            season_year: 2025,
            league_key: 'mlb.l.67890',
            league_name: 'League Two',
            team_id: '5',
            team_key: 'mlb.l.67890.t.5',
            is_default: false,
          },
        ],
        error: null,
      });

      const result = await storage.getYahooLeagues('user_123');

      expect(result).toHaveLength(2);
      expect(result[0].leagueName).toBe('League One');
      expect(result[0].isDefault).toBe(true);
      expect(result[1].leagueName).toBe('League Two');
    });

    it('returns empty array when no leagues exist', async () => {
      mockEq.mockReturnValue({
        data: [],
        error: null,
      });

      const result = await storage.getYahooLeagues('user_no_leagues');

      expect(result).toEqual([]);
    });
  });

  describe('setDefaultYahooLeague', () => {
    it('fetches league sport, clears defaults for that sport, and sets new default', async () => {
      // The flow is:
      // 1. from().select('sport').eq('id', leagueId).eq('clerk_user_id', userId).single() - fetch league sport with user verification
      // 2. from().update({is_default: false}).eq('clerk_user_id', ...).eq('sport', ...) - clear defaults
      // 3. from().update({is_default: true}).eq('id', leagueId).eq('clerk_user_id', userId) - set new default with user verification

      // Mock the select->eq->eq->single chain for fetching league sport (now has user verification)
      mockSingle.mockResolvedValueOnce({
        data: { sport: 'football' },
        error: null,
      });

      // Mock the chained eq calls properly:
      // - select().eq('id', leagueId).eq('clerk_user_id', userId).single() for fetch
      // - update().eq('clerk_user_id', ...).eq('sport', ...) for clear
      // - update().eq('id', leagueId).eq('clerk_user_id', userId) for set
      const clearEqMock = vi.fn().mockReturnValue({ error: null });
      const setEqMock = vi.fn().mockReturnValue({ error: null });
      mockEq
        .mockReturnValueOnce({ eq: vi.fn().mockReturnValue({ single: mockSingle }) }) // select().eq('id') -> returns { eq } for clerk_user_id
        .mockReturnValueOnce({ eq: clearEqMock }) // update().eq('clerk_user_id') -> returns { eq } for sport
        .mockReturnValueOnce({ eq: setEqMock }); // update().eq('id') -> returns { eq } for clerk_user_id

      await storage.setDefaultYahooLeague('user_123', 'league-uuid');

      // Should call select to get the league's sport
      expect(mockSelect).toHaveBeenCalledWith('sport');
      // Should call update twice (clear + set)
      expect(mockUpdate).toHaveBeenCalledTimes(2);
    });

    it('throws if league not found', async () => {
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'No rows' },
      });

      await expect(
        storage.setDefaultYahooLeague('user_123', 'nonexistent-league')
      ).rejects.toThrow('League not found');
    });
  });

  describe('deleteYahooLeague', () => {
    it('deletes a specific league', async () => {
      mockEq.mockReturnValue({
        eq: vi.fn().mockReturnValue({ error: null }),
      });

      await storage.deleteYahooLeague('user_123', 'league-uuid');

      expect(mockFrom).toHaveBeenCalledWith('yahoo_leagues');
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  describe('deleteAllYahooLeagues', () => {
    it('deletes all leagues for a user', async () => {
      mockEq.mockReturnValue({ error: null });

      await storage.deleteAllYahooLeagues('user_123');

      expect(mockFrom).toHaveBeenCalledWith('yahoo_leagues');
      expect(mockDelete).toHaveBeenCalled();
      expect(mockEq).toHaveBeenCalledWith('clerk_user_id', 'user_123');
    });
  });

  // ===========================================================================
  // Factory Method Tests
  // ===========================================================================

  describe('fromEnvironment', () => {
    it('creates instance from environment variables', () => {
      const instance = YahooStorage.fromEnvironment({
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_SERVICE_KEY: 'service-key',
      });

      expect(instance).toBeInstanceOf(YahooStorage);
    });
  });
});
