import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleYahooAuthorize,
  handleYahooCallback,
  handleYahooCredentials,
  handleYahooDisconnect,
  handleYahooDiscover,
  handleYahooStatus,
  type YahooConnectEnv,
} from '../yahoo-connect-handlers';
import { YahooStorage } from '../yahoo-storage';

// Mock YahooStorage
vi.mock('../yahoo-storage', () => ({
  YahooStorage: {
    fromEnvironment: vi.fn(),
  },
}));

// Mock global fetch for Yahoo OAuth API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const env: YahooConnectEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  YAHOO_CLIENT_ID: 'test-yahoo-client-id',
  YAHOO_CLIENT_SECRET: 'test-yahoo-client-secret',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
};

describe('yahoo-connect-handlers', () => {
  let mockStorage: {
    createPlatformOAuthState: ReturnType<typeof vi.fn>;
    consumePlatformOAuthState: ReturnType<typeof vi.fn>;
    saveYahooCredentials: ReturnType<typeof vi.fn>;
    getYahooCredentials: ReturnType<typeof vi.fn>;
    updateYahooCredentials: ReturnType<typeof vi.fn>;
    acquireRefreshLease: ReturnType<typeof vi.fn>;
    releaseRefreshLease: ReturnType<typeof vi.fn>;
    deleteYahooCredentials: ReturnType<typeof vi.fn>;
    deleteAllYahooLeagues: ReturnType<typeof vi.fn>;
    hasYahooCredentials: ReturnType<typeof vi.fn>;
    getYahooLeagues: ReturnType<typeof vi.fn>;
    upsertYahooLeague: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockStorage = {
      createPlatformOAuthState: vi.fn().mockResolvedValue(undefined),
      consumePlatformOAuthState: vi.fn(),
      saveYahooCredentials: vi.fn().mockResolvedValue(undefined),
      getYahooCredentials: vi.fn(),
      updateYahooCredentials: vi.fn().mockResolvedValue(true),
      acquireRefreshLease: vi.fn().mockResolvedValue(true),
      releaseRefreshLease: vi.fn().mockResolvedValue(undefined),
      deleteYahooCredentials: vi.fn().mockResolvedValue(undefined),
      deleteAllYahooLeagues: vi.fn().mockResolvedValue(undefined),
      hasYahooCredentials: vi.fn(),
      getYahooLeagues: vi.fn(),
      upsertYahooLeague: vi.fn().mockResolvedValue('league-id'),
    };

    vi.mocked(YahooStorage.fromEnvironment).mockReturnValue(mockStorage as unknown as YahooStorage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // handleYahooAuthorize Tests
  // ===========================================================================

  describe('handleYahooAuthorize', () => {
    it('redirects to Yahoo OAuth with correct params', async () => {
      const userId = 'user_abc123';

      const response = await handleYahooAuthorize(env, userId, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location');
      expect(location).toBeTruthy();

      const redirectUrl = new URL(location!);
      expect(redirectUrl.hostname).toBe('api.login.yahoo.com');
      expect(redirectUrl.pathname).toBe('/oauth2/request_auth');
      expect(redirectUrl.searchParams.get('client_id')).toBe('test-yahoo-client-id');
      expect(redirectUrl.searchParams.get('response_type')).toBe('code');
      expect(redirectUrl.searchParams.get('scope')).toBe('fspt-r');

      // State should be stored
      expect(mockStorage.createPlatformOAuthState).toHaveBeenCalledWith(
        expect.objectContaining({
          clerkUserId: userId,
          platform: 'yahoo',
        })
      );
    });

    it('generates a state containing userId and nonce', async () => {
      const userId = 'user_xyz789';

      await handleYahooAuthorize(env, userId, corsHeaders);

      const createStateCall = mockStorage.createPlatformOAuthState.mock.calls[0][0];
      expect(createStateCall.state).toContain(userId);
      expect(createStateCall.state).toMatch(/user_xyz789:[a-z0-9-]+/);
    });

    it('includes correct redirect_uri for production', async () => {
      const prodEnv: YahooConnectEnv = {
        ...env,
        ENVIRONMENT: 'production',
      };

      const response = await handleYahooAuthorize(prodEnv, 'user_123', corsHeaders);

      const location = response.headers.get('Location')!;
      const redirectUrl = new URL(location);
      expect(redirectUrl.searchParams.get('redirect_uri')).toBe('https://api.flaim.app/auth/connect/yahoo/callback');
    });

    it('includes correct redirect_uri for dev environment', async () => {
      const devEnv: YahooConnectEnv = {
        ...env,
        ENVIRONMENT: 'dev',
      };

      const response = await handleYahooAuthorize(devEnv, 'user_123', corsHeaders);

      const location = response.headers.get('Location')!;
      const redirectUrl = new URL(location);
      expect(redirectUrl.searchParams.get('redirect_uri')).toBe('http://localhost:8786/connect/yahoo/callback');
    });
  });

  // ===========================================================================
  // handleYahooCallback Tests
  // ===========================================================================

  describe('handleYahooCallback', () => {
    it('returns error redirect for missing code', async () => {
      const request = new Request('https://api.flaim.app/connect/yahoo/callback?state=user_123:abc123');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location')!;
      expect(location).toContain('/leagues');
      expect(location).toContain('error=missing_code');
    });

    it('uses FRONTEND_URL override for callback redirects', async () => {
      const request = new Request('https://api.flaim.app/connect/yahoo/callback?state=user_123:abc123');
      const response = await handleYahooCallback(
        request,
        {
          ...env,
          ENVIRONMENT: 'preview',
          FRONTEND_URL: 'https://preview.example.com/',
        },
        corsHeaders
      );

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get('Location')!);
      expect(location.origin).toBe('https://preview.example.com');
      expect(location.pathname).toBe('/leagues');
      expect(location.searchParams.get('error')).toBe('missing_code');
    });

    it('returns error redirect for missing state', async () => {
      const request = new Request('https://api.flaim.app/connect/yahoo/callback?code=auth_code');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location')!;
      expect(location).toContain('error=missing_state');
    });

    it('returns error redirect for invalid state', async () => {
      mockStorage.consumePlatformOAuthState.mockResolvedValue(null);

      const request = new Request('https://api.flaim.app/connect/yahoo/callback?code=auth_code&state=invalid_state');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location')!;
      expect(location).toContain('error=invalid_state');
    });

    it('exchanges code for tokens and saves credentials on success', async () => {
      mockStorage.consumePlatformOAuthState.mockResolvedValue({
        clerkUserId: 'user_abc123',
        platform: 'yahoo',
        redirectAfter: undefined,
      });

      // Mock successful token exchange
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'yahoo-access-token',
            refresh_token: 'yahoo-refresh-token',
            expires_in: 3600,
            xoauth_yahoo_guid: 'yahoo-guid-123',
          }),
          { status: 200 }
        )
      );

      const request = new Request('https://api.flaim.app/connect/yahoo/callback?code=auth_code&state=user_abc123:nonce');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location')!;
      expect(location).toContain('/leagues');
      expect(location).toContain('yahoo=connected');

      // Verify credentials were saved
      expect(mockStorage.saveYahooCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          clerkUserId: 'user_abc123',
          accessToken: 'yahoo-access-token',
          refreshToken: 'yahoo-refresh-token',
          yahooGuid: 'yahoo-guid-123',
        })
      );
    });

    it('returns error redirect when token exchange fails', async () => {
      mockStorage.consumePlatformOAuthState.mockResolvedValue({
        clerkUserId: 'user_abc123',
        platform: 'yahoo',
      });

      // Mock failed token exchange
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Code expired',
          }),
          { status: 400 }
        )
      );

      const request = new Request('https://api.flaim.app/connect/yahoo/callback?code=expired_code&state=user_abc123:nonce');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location')!;
      expect(location).toContain('error=token_exchange_failed');
    });
  });

  // ===========================================================================
  // handleYahooCredentials Tests
  // ===========================================================================

  describe('handleYahooCredentials', () => {
    it('returns access token when credentials are fresh', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'fresh-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 mins from now
        needsRefresh: false,
      });

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.access_token).toBe('fresh-access-token');
    });

    it('refreshes token when needsRefresh is true', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 mins from now (within 5 min buffer)
        needsRefresh: true,
      });

      // Mock successful refresh
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
          }),
          { status: 200 }
        )
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.access_token).toBe('new-access-token');

      // Verify credentials were updated (3rd arg is the lease ownerId)
      expect(mockStorage.updateYahooCredentials).toHaveBeenCalledWith(
        'user_123',
        expect.objectContaining({
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
        }),
        expect.any(String)
      );
    });

    it('returns 404 when no credentials exist', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue(null);

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(404);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('not_connected');
    });

    it('returns error when refresh fails', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-access-token',
        refreshToken: 'invalid-refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });

      // Mock failed refresh
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Refresh token expired',
          }),
          { status: 400 }
        )
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(401);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('refresh_failed');
      expect(body.error_description).toBe('Refresh token expired');
    });

    it('uses newer stored credentials when a concurrent refresh already succeeded', async () => {
      const originalUpdatedAt = new Date('2026-04-10T13:50:00Z');
      const refreshedUpdatedAt = new Date('2026-04-10T13:50:05Z');

      mockStorage.getYahooCredentials
        .mockResolvedValueOnce({
          clerkUserId: 'user_123',
          accessToken: 'old-access-token',
          refreshToken: 'stale-refresh-token',
          expiresAt: new Date(Date.now() + 2 * 60 * 1000),
          needsRefresh: true,
          updatedAt: originalUpdatedAt,
        })
        .mockResolvedValueOnce({
          clerkUserId: 'user_123',
          accessToken: 'fresh-access-token',
          refreshToken: 'fresh-refresh-token',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          needsRefresh: false,
          updatedAt: refreshedUpdatedAt,
        });

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Refresh token already used',
          }),
          { status: 400 }
        )
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.access_token).toBe('fresh-access-token');
      expect(mockStorage.updateYahooCredentials).not.toHaveBeenCalled();
    });

    it('winner: lease acquired, refresh succeeds, write lands', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });
      mockStorage.acquireRefreshLease.mockResolvedValue(true);
      mockStorage.updateYahooCredentials.mockResolvedValue(true);
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: 'winner-token', refresh_token: 'new-refresh', expires_in: 3600 }),
          { status: 200 }
        )
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.access_token).toBe('winner-token');
      expect(mockStorage.acquireRefreshLease).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('winner: Yahoo timeout (AbortError) releases lease and returns refresh_failed', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });
      mockStorage.acquireRefreshLease.mockResolvedValue(true);

      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValue(abortError);

      let capturedOwnerId: string | undefined;
      mockStorage.acquireRefreshLease.mockImplementation(
        (_userId: string, ownerId: string) => {
          capturedOwnerId = ownerId;
          return Promise.resolve(true);
        }
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(401);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('refresh_failed');
      expect(mockStorage.releaseRefreshLease).toHaveBeenCalledWith('user_123', capturedOwnerId);
    });

    it('winner: lease release failure after timeout still returns refresh_failed', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });
      mockStorage.acquireRefreshLease.mockResolvedValue(true);
      mockStorage.releaseRefreshLease.mockRejectedValue(new Error('release failed'));

      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValue(abortError);

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(401);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('refresh_failed');
      expect(body.error_description).toBe('Failed to refresh access token');
    });

    it('winner: owner-guarded write returns false, reread shows fresh token', async () => {
      mockStorage.getYahooCredentials
        .mockResolvedValueOnce({
          clerkUserId: 'user_123',
          accessToken: 'old-access-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 2 * 60 * 1000),
          needsRefresh: true,
        })
        .mockResolvedValueOnce({
          clerkUserId: 'user_123',
          accessToken: 'concurrent-fresh-token',
          refreshToken: 'concurrent-refresh',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          needsRefresh: false,
        });
      mockStorage.acquireRefreshLease.mockResolvedValue(true);
      mockStorage.updateYahooCredentials.mockResolvedValue(false); // owner guard failed
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: 'winner-token', refresh_token: 'new-refresh', expires_in: 3600 }),
          { status: 200 }
        )
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.access_token).toBe('concurrent-fresh-token');
    });

    it('loser: lease not acquired, winner finishes before deadline', async () => {
      const stale = {
        clerkUserId: 'user_123',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
        refreshLeaseOwner: 'other-owner',
        refreshLeaseExpiresAt: new Date(Date.now() + 30_000),
      };
      const fresh = {
        clerkUserId: 'user_123',
        accessToken: 'fresh-token',
        refreshToken: 'fresh-refresh',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        needsRefresh: false,
      };

      mockStorage.getYahooCredentials
        .mockResolvedValueOnce(stale)  // initial read
        .mockResolvedValueOnce(fresh); // first poll
      mockStorage.acquireRefreshLease.mockResolvedValue(false);

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.access_token).toBe('fresh-token');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('loser: lease expires before winner writes, then reacquires and refreshes', async () => {
      const stale = {
        clerkUserId: 'user_123',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
        refreshLeaseOwner: 'other-owner',
        refreshLeaseExpiresAt: new Date(Date.now() - 1), // already expired — skips loop
      };

      mockStorage.getYahooCredentials
        .mockResolvedValueOnce(stale)
        .mockResolvedValueOnce(stale);
      mockStorage.acquireRefreshLease
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mockStorage.updateYahooCredentials.mockResolvedValue(true);
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: 'recovered-token', refresh_token: 'new-refresh', expires_in: 3600 }),
          { status: 200 }
        )
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.access_token).toBe('recovered-token');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('loser: stale pre-race lease rereads current winner lease before waiting', async () => {
      const stalePreRaceLease = {
        clerkUserId: 'user_123',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
        refreshLeaseOwner: 'expired-owner',
        refreshLeaseExpiresAt: new Date(Date.now() - 1),
      };
      const currentWinnerLease = {
        clerkUserId: 'user_123',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
        refreshLeaseOwner: 'new-owner',
        refreshLeaseExpiresAt: new Date(Date.now() + 30_000),
      };
      const fresh = {
        clerkUserId: 'user_123',
        accessToken: 'fresh-from-winner',
        refreshToken: 'fresh-refresh',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        needsRefresh: false,
      };

      mockStorage.getYahooCredentials
        .mockResolvedValueOnce(stalePreRaceLease)
        .mockResolvedValueOnce(currentWinnerLease)
        .mockResolvedValueOnce(fresh);
      mockStorage.acquireRefreshLease.mockResolvedValue(false);

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.access_token).toBe('fresh-from-winner');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('winner: owner-guarded write fails, stale reread retries safely instead of writing unguarded', async () => {
      const leaseHeldByOther = {
        clerkUserId: 'user_123',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
        refreshLeaseOwner: 'other-owner',
        refreshLeaseExpiresAt: new Date(Date.now() + 30_000),
      };
      const fresh = {
        clerkUserId: 'user_123',
        accessToken: 'fresh-token',
        refreshToken: 'fresh-refresh',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        needsRefresh: false,
      };

      mockStorage.getYahooCredentials
        .mockResolvedValueOnce({
          clerkUserId: 'user_123',
          accessToken: 'old-token',
          refreshToken: 'old-refresh',
          expiresAt: new Date(Date.now() + 2 * 60 * 1000),
          needsRefresh: true,
        })
        .mockResolvedValueOnce(leaseHeldByOther)
        .mockResolvedValueOnce(fresh);
      mockStorage.acquireRefreshLease
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockStorage.updateYahooCredentials.mockResolvedValue(false);
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: 'winner-token', refresh_token: 'new-refresh', expires_in: 3600 }),
          { status: 200 }
        )
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.access_token).toBe('fresh-token');
      expect(mockStorage.updateYahooCredentials).toHaveBeenCalledTimes(1);
    });

    it('returns server_error when lease acquisition storage call fails', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });
      mockStorage.acquireRefreshLease.mockRejectedValue(new Error('db unavailable'));

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(500);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('server_error');
    });
  });

  // ===========================================================================
  // handleYahooDisconnect Tests
  // ===========================================================================

  describe('handleYahooDisconnect', () => {
    it('deletes credentials and leagues and returns success', async () => {
      const response = await handleYahooDisconnect(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.success).toBe(true);

      expect(mockStorage.deleteYahooCredentials).toHaveBeenCalledWith('user_123');
      expect(mockStorage.deleteAllYahooLeagues).toHaveBeenCalledWith('user_123');
    });

    it('returns success even when no credentials exist', async () => {
      mockStorage.deleteYahooCredentials.mockResolvedValue(undefined);
      mockStorage.deleteAllYahooLeagues.mockResolvedValue(undefined);

      const response = await handleYahooDisconnect(env, 'nonexistent_user', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.success).toBe(true);
    });
  });

  // ===========================================================================
  // handleYahooStatus Tests
  // ===========================================================================

  describe('handleYahooStatus', () => {
    it('returns connected=true with league count and lastUpdated when credentials exist', async () => {
      const mockUpdatedAt = new Date('2026-01-25T12:00:00Z');
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: new Date(),
        needsRefresh: false,
        updatedAt: mockUpdatedAt,
      });
      mockStorage.getYahooLeagues.mockResolvedValue([
        { id: 'league-1', leagueName: 'League One' },
        { id: 'league-2', leagueName: 'League Two' },
      ]);

      const response = await handleYahooStatus(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.connected).toBe(true);
      expect(body.leagueCount).toBe(2);
      expect(body.lastUpdated).toBe(mockUpdatedAt.toISOString());
    });

    it('returns connected=false when no credentials exist', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue(null);
      mockStorage.getYahooLeagues.mockResolvedValue([]);

      const response = await handleYahooStatus(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.connected).toBe(false);
      expect(body.leagueCount).toBe(0);
      expect(body.lastUpdated).toBeUndefined();
    });
  });

  // ===========================================================================
  // handleYahooDiscover Tests (refresh lease)
  // ===========================================================================

  describe('handleYahooDiscover (refresh lease)', () => {
    it('loser waits and proceeds with fresh token after winner finishes', async () => {
      const stale = {
        clerkUserId: 'user_123',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
        refreshLeaseOwner: 'other-owner',
        refreshLeaseExpiresAt: new Date(Date.now() + 30_000),
      };
      const fresh = {
        clerkUserId: 'user_123',
        accessToken: 'fresh-token',
        refreshToken: 'fresh-refresh',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        needsRefresh: false,
      };

      // discover handler reads credentials once, then the helper polls from the live lease state
      mockStorage.getYahooCredentials
        .mockResolvedValueOnce(stale)  // initial check in handler
        .mockResolvedValueOnce(fresh); // first poll in loser loop
      mockStorage.acquireRefreshLease.mockResolvedValue(false);

      // Mock Yahoo API discovery response
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({ fantasy_content: { users: { count: 0 } } }),
          { status: 200 }
        )
      );

      const response = await handleYahooDiscover(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      // Discovery succeeded with the fresh token; Yahoo API fetch was called once (for discovery)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockStorage.getYahooCredentials).toHaveBeenCalledTimes(2);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.success).toBe(true);
    });

    it('returns Yahoo refresh error description from discovery path', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-token',
        refreshToken: 'bad-refresh',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });
      mockStorage.acquireRefreshLease.mockResolvedValue(true);
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Refresh token already used',
          }),
          { status: 400 }
        )
      );

      const response = await handleYahooDiscover(env, 'user_123', corsHeaders);

      expect(response.status).toBe(401);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('refresh_failed');
      expect(body.error_description).toBe('Refresh token already used');
    });
  });
});
