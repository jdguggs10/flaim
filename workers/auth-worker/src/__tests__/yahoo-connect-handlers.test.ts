import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleYahooAuthorize,
  handleYahooCallback,
  handleYahooCredentials,
  handleYahooCredentialHealth,
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

function yahooRefreshDiagnostics(spy: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map(call => String(call[0]))
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry?.component === 'yahoo-connect');
}

describe('yahoo-connect-handlers', () => {
  let mockStorage: {
    createPlatformOAuthState: ReturnType<typeof vi.fn>;
    consumePlatformOAuthState: ReturnType<typeof vi.fn>;
    saveYahooCredentials: ReturnType<typeof vi.fn>;
    getYahooCredentials: ReturnType<typeof vi.fn>;
    getYahooCredentialHealth: ReturnType<typeof vi.fn>;
    updateYahooCredentials: ReturnType<typeof vi.fn>;
    acquireRefreshLease: ReturnType<typeof vi.fn>;
    releaseRefreshLease: ReturnType<typeof vi.fn>;
    markRefreshCooldown: ReturnType<typeof vi.fn>;
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
      getYahooCredentialHealth: vi.fn(),
      updateYahooCredentials: vi.fn().mockResolvedValue(true),
      acquireRefreshLease: vi.fn().mockResolvedValue(true),
      releaseRefreshLease: vi.fn().mockResolvedValue(undefined),
      markRefreshCooldown: vi.fn().mockResolvedValue(true),
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

      // Mock successful token exchange, then the callback's immediate refresh validation
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'yahoo-access-token',
              refresh_token: 'yahoo-refresh-token',
              expires_in: 3600,
              xoauth_yahoo_guid: 'yahoo-guid-123',
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'validated-access-token',
              refresh_token: 'validated-refresh-token',
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
          accessToken: 'validated-access-token',
          refreshToken: 'validated-refresh-token',
          yahooGuid: 'yahoo-guid-123',
        })
      );

      const exchangeRequest = mockFetch.mock.calls[0][1] as RequestInit;
      const exchangeBody = new URLSearchParams(exchangeRequest.body as string);
      expect(exchangeBody.get('grant_type')).toBe('authorization_code');
      expect(exchangeBody.get('redirect_uri')).toBe('https://api.flaim.app/auth/connect/yahoo/callback');

      const validationRequest = mockFetch.mock.calls[1][1] as RequestInit;
      const validationBody = new URLSearchParams(validationRequest.body as string);
      expect(validationBody.get('grant_type')).toBe('refresh_token');
      expect(validationBody.get('refresh_token')).toBe('yahoo-refresh-token');
      expect(validationBody.get('redirect_uri')).toBe('https://api.flaim.app/auth/connect/yahoo/callback');
    });

    it('keeps the original refresh token when callback validation does not rotate it', async () => {
      mockStorage.consumePlatformOAuthState.mockResolvedValue({
        clerkUserId: 'user_abc123',
        platform: 'yahoo',
        redirectAfter: undefined,
      });

      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'yahoo-access-token',
              refresh_token: 'yahoo-refresh-token',
              expires_in: 3600,
              xoauth_yahoo_guid: 'yahoo-guid-123',
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'validated-access-token',
              expires_in: 3600,
              xoauth_yahoo_guid: 'yahoo-guid-123',
            }),
            { status: 200 }
          )
        );

      const request = new Request('https://api.flaim.app/connect/yahoo/callback?code=auth_code&state=user_abc123:nonce');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      expect(mockStorage.saveYahooCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'validated-access-token',
          refreshToken: 'yahoo-refresh-token',
        })
      );
    });

    it('returns error redirect when refresh validation fails after token exchange', async () => {
      mockStorage.consumePlatformOAuthState.mockResolvedValue({
        clerkUserId: 'user_abc123',
        platform: 'yahoo',
      });

      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'yahoo-access-token',
              refresh_token: 'bad-refresh-token',
              expires_in: 3600,
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: 'invalid_grant',
              error_description: 'Refresh token rejected',
            }),
            { status: 400 }
          )
        );

      const request = new Request('https://api.flaim.app/connect/yahoo/callback?code=auth_code&state=user_abc123:nonce');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location')!;
      expect(location).toContain('error=token_refresh_validation_failed');
      expect(mockStorage.saveYahooCredentials).not.toHaveBeenCalled();
    });

    it('returns temporary error redirect when refresh validation has a transient Yahoo error', async () => {
      mockStorage.consumePlatformOAuthState.mockResolvedValue({
        clerkUserId: 'user_abc123',
        platform: 'yahoo',
      });

      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'yahoo-access-token',
              refresh_token: 'yahoo-refresh-token',
              expires_in: 3600,
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: 'temporarily_unavailable',
              error_description: 'Try again later',
            }),
            { status: 503 }
          )
        );

      const request = new Request('https://api.flaim.app/connect/yahoo/callback?code=auth_code&state=user_abc123:nonce');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location')!;
      expect(location).toContain('error=token_refresh_validation_unavailable');
      expect(mockStorage.saveYahooCredentials).not.toHaveBeenCalled();
    });

    it('returns temporary error redirect when refresh validation returns non-JSON Too many body', async () => {
      mockStorage.consumePlatformOAuthState.mockResolvedValue({
        clerkUserId: 'user_abc123',
        platform: 'yahoo',
      });

      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'yahoo-access-token',
              refresh_token: 'yahoo-refresh-token',
              expires_in: 3600,
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response('Too many requests to Yahoo token endpoint', {
            status: 400,
            headers: { 'Content-Type': 'text/plain' },
          })
        );

      const request = new Request('https://api.flaim.app/connect/yahoo/callback?code=auth_code&state=user_abc123:nonce');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location')!;
      expect(location).toContain('error=token_refresh_validation_unavailable');
      expect(mockStorage.saveYahooCredentials).not.toHaveBeenCalled();
    });

    it('returns temporary error redirect when refresh validation aborts', async () => {
      mockStorage.consumePlatformOAuthState.mockResolvedValue({
        clerkUserId: 'user_abc123',
        platform: 'yahoo',
      });

      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'yahoo-access-token',
              refresh_token: 'yahoo-refresh-token',
              expires_in: 3600,
            }),
            { status: 200 }
          )
        )
        .mockRejectedValueOnce(abortError);

      const request = new Request('https://api.flaim.app/connect/yahoo/callback?code=auth_code&state=user_abc123:nonce');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location')!;
      expect(location).toContain('error=token_refresh_validation_unavailable');
      expect(mockStorage.saveYahooCredentials).not.toHaveBeenCalled();
    });

    it('returns error redirect when refresh validation omits expires_in', async () => {
      mockStorage.consumePlatformOAuthState.mockResolvedValue({
        clerkUserId: 'user_abc123',
        platform: 'yahoo',
      });

      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'yahoo-access-token',
              refresh_token: 'yahoo-refresh-token',
              expires_in: 3600,
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'validated-access-token',
            }),
            { status: 200 }
          )
        );

      const request = new Request('https://api.flaim.app/connect/yahoo/callback?code=auth_code&state=user_abc123:nonce');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location')!;
      expect(location).toContain('error=token_refresh_validation_failed');
      expect(mockStorage.saveYahooCredentials).not.toHaveBeenCalled();
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

    it('returns temporary error redirect when token exchange request fails', async () => {
      mockStorage.consumePlatformOAuthState.mockResolvedValue({
        clerkUserId: 'user_abc123',
        platform: 'yahoo',
      });

      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValue(abortError);

      const request = new Request('https://api.flaim.app/connect/yahoo/callback?code=auth_code&state=user_abc123:nonce');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location')!;
      expect(location).toContain('error=token_exchange_unavailable');
      expect(mockStorage.saveYahooCredentials).not.toHaveBeenCalled();
    });

    it('returns temporary error redirect when token exchange returns non-JSON Too many body', async () => {
      mockStorage.consumePlatformOAuthState.mockResolvedValue({
        clerkUserId: 'user_abc123',
        platform: 'yahoo',
      });

      mockFetch.mockResolvedValue(
        new Response('Too many requests to Yahoo token endpoint', {
          status: 400,
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      const request = new Request('https://api.flaim.app/connect/yahoo/callback?code=auth_code&state=user_abc123:nonce');

      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location')!;
      expect(location).toContain('error=token_exchange_unavailable');
      expect(mockStorage.saveYahooCredentials).not.toHaveBeenCalled();
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

    it('logs a non-secret diagnostic when returning a fresh token', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123456789',
        accessToken: 'fresh-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        needsRefresh: false,
      });

      await handleYahooCredentials(env, 'user_123456789', corsHeaders, 'req_123');

      const diagnostics = yahooRefreshDiagnostics(logSpy);
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'token_fresh_returned',
            user_id: 'user_123...',
            correlation_id: 'req_123',
          }),
        ])
      );
      const serialized = JSON.stringify(diagnostics);
      expect(serialized).not.toContain('fresh-access-token');
      expect(serialized).not.toContain('refresh-token');
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

      const refreshRequest = mockFetch.mock.calls[0][1] as RequestInit;
      const refreshBody = new URLSearchParams(refreshRequest.body as string);
      expect(refreshBody.get('grant_type')).toBe('refresh_token');
      expect(refreshBody.get('redirect_uri')).toBe('https://api.flaim.app/auth/connect/yahoo/callback');
      expect(mockStorage.acquireRefreshLease).toHaveBeenCalledWith(
        'user_123',
        expect.any(String),
        30_000,
        'refresh-token'
      );

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

    it('returns retryable 503 when Yahoo returns a non-JSON Too many token response', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });

      let capturedOwnerId: string | undefined;
      mockStorage.acquireRefreshLease.mockImplementation(
        (_userId: string, ownerId: string) => {
          capturedOwnerId = ownerId;
          return Promise.resolve(true);
        }
      );

      mockFetch.mockResolvedValue(
        new Response('Too many requests to Yahoo token endpoint', {
          status: 400,
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(503);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('refresh_temporarily_unavailable');
      expect(body.error_description).toBe('Failed to refresh access token');
      expect(body.retryable).toBe(true);
      expect(body.retry_after).toBe(60);
      expect(response.headers.get('Retry-After')).toBe('60');
      expect(mockStorage.markRefreshCooldown).toHaveBeenCalledWith('user_123', capturedOwnerId, 60);
      expect(mockStorage.releaseRefreshLease).not.toHaveBeenCalled();
      expect(mockStorage.updateYahooCredentials).not.toHaveBeenCalled();
    });

    it('does not treat permanent token failures as retryable just because the body says too many', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });
      mockStorage.acquireRefreshLease.mockResolvedValue(true);

      mockFetch.mockResolvedValue(
        new Response('Too many reconnect attempts, token permanently revoked', {
          status: 400,
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(401);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('refresh_failed');
      expect(body.error_description).toBe('Failed to refresh access token');
      expect(body.retryable).toBeUndefined();
      expect(mockStorage.updateYahooCredentials).not.toHaveBeenCalled();
    });

    it('does not treat mixed permanent and transient token response fields as retryable', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });
      mockStorage.acquireRefreshLease.mockResolvedValue(true);

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'temporarily_unavailable',
            error_description: 'Refresh token permanently revoked',
          }),
          { status: 400 }
        )
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(401);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('refresh_failed');
      expect(body.error_description).toBe('Refresh token permanently revoked');
      expect(body.retryable).toBeUndefined();
      expect(mockStorage.updateYahooCredentials).not.toHaveBeenCalled();
    });

    it('returns retryable 503 when Yahoo returns a transient refresh status', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });
      mockStorage.acquireRefreshLease.mockResolvedValue(true);

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'temporarily_unavailable',
            error_description: 'Try again later',
          }),
          { status: 503 }
        )
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(503);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('refresh_temporarily_unavailable');
      expect(body.error_description).toBe('Try again later');
      expect(body.retryable).toBe(true);
      expect(body.retry_after).toBe(300);
      expect(body.upstream_status).toBe(503);
      expect(mockStorage.markRefreshCooldown).toHaveBeenCalledWith('user_123', expect.any(String), 300);
      expect(mockStorage.updateYahooCredentials).not.toHaveBeenCalled();
    });

    it('returns retryable 503 when Yahoo returns HTTP 429 during refresh', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });
      mockStorage.acquireRefreshLease.mockResolvedValue(true);

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'rate_limited',
            error_description: 'Too many token requests',
          }),
          { status: 429 }
        )
      );

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders, 'req_429');

      expect(response.status).toBe(503);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('refresh_temporarily_unavailable');
      expect(body.error_description).toBe('Too many token requests');
      expect(body.retryable).toBe(true);
      expect(body.retry_after).toBe(900);
      expect(body.upstream_status).toBe(429);
      expect(mockStorage.markRefreshCooldown).toHaveBeenCalledWith('user_123', expect.any(String), 900);
      expect(mockStorage.updateYahooCredentials).not.toHaveBeenCalled();

      const diagnostics = yahooRefreshDiagnostics(logSpy);
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'refresh_response_error',
            correlation_id: 'req_429',
            upstream_status: 429,
            token_error: 'rate_limited',
            failure_kind: 'transient_http',
          }),
          expect.objectContaining({
            event: 'refresh_transient_failure',
            retry_after: 900,
          }),
          expect.objectContaining({
            event: 'cooldown_mark_attempted',
            retry_after: 900,
            cooldown_marked: true,
          }),
        ])
      );
      const serialized = JSON.stringify(diagnostics);
      expect(serialized).not.toContain('old-access-token');
      expect(serialized).not.toContain('refresh-token');
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

    it('winner: Yahoo timeout (AbortError) marks cooldown and returns retryable temporary error', async () => {
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

      expect(response.status).toBe(503);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('refresh_temporarily_unavailable');
      expect(body.error_description).toBe('Yahoo token refresh timed out. Please try again later.');
      expect(body.retryable).toBe(true);
      expect(body.retry_after).toBe(300);
      expect(mockStorage.markRefreshCooldown).toHaveBeenCalledWith('user_123', capturedOwnerId, 300);
      expect(mockStorage.releaseRefreshLease).not.toHaveBeenCalled();
    });

    it('winner: cooldown mark failure after timeout falls back to releasing the lease', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });
      mockStorage.acquireRefreshLease.mockResolvedValue(true);
      mockStorage.markRefreshCooldown.mockRejectedValue(new Error('cooldown failed'));

      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValue(abortError);

      const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

      expect(response.status).toBe(503);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('refresh_temporarily_unavailable');
      expect(body.error_description).toBe('Yahoo token refresh timed out. Please try again later.');
      expect(body.retryable).toBe(true);
      expect(mockStorage.releaseRefreshLease).toHaveBeenCalledWith('user_123', expect.any(String));
    });

    it('returns active refresh cooldown without hitting Yahoo again', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-11T18:15:00Z'));
      try {
        mockStorage.getYahooCredentials.mockResolvedValue({
          clerkUserId: 'user_123',
          accessToken: 'old-access-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 2 * 60 * 1000),
          needsRefresh: true,
          refreshLeaseOwner: 'cooldown:owner-1',
          refreshLeaseExpiresAt: new Date(Date.now() + 45_000),
        });
        mockStorage.acquireRefreshLease.mockResolvedValue(false);

        const response = await handleYahooCredentials(env, 'user_123', corsHeaders);

        expect(response.status).toBe(503);
        expect(response.headers.get('Retry-After')).toBe('45');
        const body = (await response.json()) as Record<string, unknown>;
        expect(body.error).toBe('refresh_temporarily_unavailable');
        expect(body.error_description).toBe('Yahoo token refresh is cooling down after a transient failure. Please try again shortly.');
        expect(body.retryable).toBe(true);
        expect(body.retry_after).toBe(45);
        expect(mockStorage.acquireRefreshLease).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockStorage.markRefreshCooldown).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
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
  // handleYahooCredentialHealth Tests
  // ===========================================================================

  describe('handleYahooCredentialHealth', () => {
    it('returns non-secret credential health for a fresh token', async () => {
      const expiresAt = new Date('2026-05-12T02:00:00Z');
      const updatedAt = new Date('2026-05-12T01:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-12T01:30:00Z'));
      try {
        mockStorage.getYahooCredentialHealth.mockResolvedValue({
          clerkUserId: 'user_123',
          expiresAt,
          yahooGuidPresent: true,
          needsRefresh: false,
          updatedAt,
        });

        const response = await handleYahooCredentialHealth(env, 'user_123', corsHeaders);

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        const body = (await response.json()) as Record<string, any>;
        expect(body).toEqual({
          connected: true,
          hasCredentials: true,
          platform: 'yahoo',
          checkedAt: '2026-05-12T01:30:00.000Z',
          lastUpdated: '2026-05-12T01:00:00.000Z',
          yahooGuidPresent: true,
          accessToken: {
            expiresAt: '2026-05-12T02:00:00.000Z',
            expiresInSeconds: 1800,
            needsRefresh: false,
            state: 'fresh',
          },
          refresh: {
            state: 'idle',
          },
        });
        expect(JSON.stringify(body)).not.toContain('access-token');
        expect(JSON.stringify(body)).not.toContain('refresh-token');
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns cooldown state without exposing the lease owner', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-12T01:30:00Z'));
      try {
        mockStorage.getYahooCredentialHealth.mockResolvedValue({
          clerkUserId: 'user_123',
          expiresAt: new Date('2026-05-12T01:31:00Z'),
          yahooGuidPresent: false,
          needsRefresh: true,
          refreshLeaseOwner: 'cooldown:owner-1',
          refreshLeaseExpiresAt: new Date('2026-05-12T01:31:15Z'),
        });

        const response = await handleYahooCredentialHealth(env, 'user_123', corsHeaders);

        expect(response.status).toBe(200);
        const body = (await response.json()) as Record<string, any>;
        expect(body.refresh).toEqual({
          state: 'cooldown',
          leaseExpiresAt: '2026-05-12T01:31:15.000Z',
          retryAfterSeconds: 75,
        });
        expect(body.accessToken).toMatchObject({
          needsRefresh: true,
          state: 'needs_refresh',
        });
        expect(JSON.stringify(body)).not.toContain('owner-1');
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns expired lease state without exposing the lease owner', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-12T01:30:00Z'));
      try {
        mockStorage.getYahooCredentialHealth.mockResolvedValue({
          clerkUserId: 'user_123',
          expiresAt: new Date('2026-05-12T01:31:00Z'),
          yahooGuidPresent: true,
          needsRefresh: true,
          refreshLeaseOwner: 'refresh:owner-1',
          refreshLeaseExpiresAt: new Date('2026-05-12T01:29:55Z'),
        });

        const response = await handleYahooCredentialHealth(env, 'user_123', corsHeaders);

        expect(response.status).toBe(200);
        const body = (await response.json()) as Record<string, any>;
        expect(body.refresh).toEqual({
          state: 'expired',
          leaseExpiresAt: '2026-05-12T01:29:55.000Z',
        });
        expect(JSON.stringify(body)).not.toContain('owner-1');
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns disconnected health when no Yahoo credential row exists', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-12T01:30:00Z'));
      try {
        mockStorage.getYahooCredentialHealth.mockResolvedValue(null);

        const response = await handleYahooCredentialHealth(env, 'user_123', corsHeaders);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          connected: false,
          hasCredentials: false,
          platform: 'yahoo',
          checkedAt: '2026-05-12T01:30:00.000Z',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns server_error when credential health lookup fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockStorage.getYahooCredentialHealth.mockRejectedValue(new Error('db offline'));

      const response = await handleYahooCredentialHealth(env, 'user_123', corsHeaders);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: 'server_error',
        error_description: 'Failed to retrieve Yahoo credential health',
      });
      expect(errorSpy).toHaveBeenCalledWith(
        '[yahoo-connect] Credential health error:',
        expect.any(Error)
      );
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

    it('returns retryable 503 when a refresh lease stays active too long', async () => {
      vi.useFakeTimers();

      const stale = {
        clerkUserId: 'user_123',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
        refreshLeaseOwner: 'other-owner',
        refreshLeaseExpiresAt: new Date(Date.now() + 30_000),
      };

      mockStorage.getYahooCredentials.mockResolvedValue(stale);
      mockStorage.acquireRefreshLease.mockResolvedValue(false);

      try {
        const responsePromise = handleYahooDiscover(env, 'user_123', corsHeaders);
        await vi.advanceTimersByTimeAsync(10_001);
        const response = await responsePromise;

        expect(response.status).toBe(503);
        expect(response.headers.get('Retry-After')).toBe('5');
        const body = (await response.json()) as Record<string, unknown>;
        expect(body.error).toBe('refresh_temporarily_unavailable');
        expect(body.retryable).toBe(true);
        expect(body.retry_after).toBe(5);
        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
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

    it('returns retryable 503 from discovery path for transient Yahoo refresh response', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'old-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        needsRefresh: true,
      });
      mockStorage.acquireRefreshLease.mockResolvedValue(true);
      mockFetch.mockResolvedValue(
        new Response('Too many requests to Yahoo token endpoint', {
          status: 400,
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      const response = await handleYahooDiscover(env, 'user_123', corsHeaders);

      expect(response.status).toBe(503);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('refresh_temporarily_unavailable');
      expect(body.error_description).toBe('Failed to refresh access token');
      expect(body.retryable).toBe(true);
      expect(body.retry_after).toBe(60);
      expect(mockStorage.markRefreshCooldown).toHaveBeenCalledWith('user_123', expect.any(String), 60);
      expect(mockStorage.updateYahooCredentials).not.toHaveBeenCalled();
      expect(mockStorage.upsertYahooLeague).not.toHaveBeenCalled();
    });

    it('returns retryable rate-limit response when Yahoo league discovery returns HTTP 999', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'fresh-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        needsRefresh: false,
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 999,
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('Yahoo rate limit'),
      } as unknown as Response);

      const response = await handleYahooDiscover(env, 'user_123', corsHeaders);

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('900');
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('yahoo_api_temporarily_unavailable');
      expect(body.retryable).toBe(true);
      expect(body.retry_after).toBe(900);
      expect(body.upstream_status).toBe(999);
      expect(mockStorage.upsertYahooLeague).not.toHaveBeenCalled();
    });

    it('preserves upstream Retry-After when Yahoo league discovery returns HTTP 429', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'fresh-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        needsRefresh: false,
      });

      mockFetch.mockResolvedValue(
        new Response('Slow down', {
          status: 429,
          headers: { 'Retry-After': '120' },
        })
      );

      const response = await handleYahooDiscover(env, 'user_123', corsHeaders);

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('120');
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('yahoo_api_temporarily_unavailable');
      expect(body.retryable).toBe(true);
      expect(body.retry_after).toBe(120);
    });

    it('returns retryable temporary response when Yahoo league discovery returns HTTP 503', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'fresh-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        needsRefresh: false,
      });

      mockFetch.mockResolvedValue(
        new Response('Yahoo unavailable', {
          status: 503,
          headers: { 'Retry-After': '30' },
        })
      );

      const response = await handleYahooDiscover(env, 'user_123', corsHeaders);

      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toBe('30');
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe('yahoo_api_temporarily_unavailable');
      expect(body.retryable).toBe(true);
      expect(body.retry_after).toBe(30);
      expect(body.upstream_status).toBe(503);
      expect(mockStorage.upsertYahooLeague).not.toHaveBeenCalled();
    });

    it('stores Yahoo team_key during league discovery', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue({
        clerkUserId: 'user_123',
        accessToken: 'fresh-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        needsRefresh: false,
      });

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            fantasy_content: {
              users: {
                count: 1,
                0: {
                  user: [
                    { guid: 'guid-123' },
                    {
                      games: {
                        count: 1,
                        0: {
                          game: [
                            { code: 'nfl', season: '2025' },
                            {
                              leagues: {
                                count: 1,
                                0: {
                                  league: [
                                    { league_key: '449.l.123', name: 'Test Yahoo League' },
                                    {
                                      teams: {
                                        count: 1,
                                        0: {
                                          team: [[
                                            { team_key: '449.l.123.t.3' },
                                            { team_id: '3' },
                                            { name: 'Gerry Team' },
                                          ]],
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          }),
          { status: 200 }
        )
      );

      const response = await handleYahooDiscover(env, 'user_123', corsHeaders);

      expect(response.status).toBe(200);
      expect(mockStorage.upsertYahooLeague).toHaveBeenCalledWith(
        expect.objectContaining({
          clerkUserId: 'user_123',
          leagueKey: '449.l.123',
          teamId: '3',
          teamKey: '449.l.123.t.3',
          teamName: 'Gerry Team',
        })
      );
    });
  });
});
