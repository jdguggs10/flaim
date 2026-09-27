import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { authWorkerFetch, YahooAuthWorkerErrorCode } from '@flaim/worker-shared';
import type { Env } from '../../types';
import { getYahooCredentials, resolveUserTeamKey } from '../auth';
import type { YahooClientError } from '../errors';

vi.mock('@flaim/worker-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@flaim/worker-shared')>();
  return {
    ...actual,
    authWorkerFetch: vi.fn(),
  };
});

const mockAuthWorkerFetch = authWorkerFetch as MockedFunction<typeof authWorkerFetch>;

describe('getYahooCredentials', () => {
  const env = {} as Env;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tells the AI to reconnect Yahoo at flaim.app/leagues on a real Yahoo invalid_grant rejection, not the raw provider detail', async () => {
    // Mirrors auth-worker's genuine-rejection producer (yahoo-connect-handlers.ts
    // ~1162-1166): a real Yahoo token-endpoint response classified as a
    // permanent OAuth failure carries `upstream_status` set to Yahoo's own
    // HTTP status (400 for invalid_grant). A single mocked Response body can
    // only be read once; asserting twice against the same rejected promise
    // call would re-read an already-consumed body on the second call and
    // silently fall through to the generic error path, so capture the
    // rejection once instead.
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_failed',
          error_description: 'invalid_grant: Refresh token expired',
          upstream_status: 400,
        }),
        { status: 401 }
      )
    );

    const error = await getYahooCredentials(env, 'Bearer token').catch((e) => e) as YahooClientError;
    expect(error).toMatchObject({ code: 'YAHOO_AUTH_ERROR' } satisfies Partial<YahooClientError>);
    expect(error.message).toContain('https://flaim.app/leagues');
    expect(error.message).toContain('Reconnecting the Flaim app in the AI client will not fix this');
  });

  it('also reconnects on a refresh_failed with upstream_status 401 (Yahoo rejected the grant)', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_failed',
          error_description: 'invalid_client: Refresh token rejected',
          upstream_status: 401,
        }),
        { status: 401 }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toMatchObject({
      code: 'YAHOO_AUTH_ERROR',
      message: expect.stringContaining('Reconnect Yahoo'),
    } satisfies Partial<YahooClientError>);
  });

  it('does not reconnect for missing Yahoo client configuration, even though the code is refresh_failed', async () => {
    // Mirrors yahoo-connect-handlers.ts ~984-987: a Flaim-side config problem,
    // not a Yahoo credential rejection. This producer never sets upstream_status
    // because there is no real Yahoo HTTP response behind it.
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_failed',
          error_description: 'Yahoo client credentials are not configured',
        }),
        { status: 401 }
      )
    );

    const error = await getYahooCredentials(env, 'Bearer token').catch((e) => e) as YahooClientError;
    expect(error).toMatchObject({ code: 'YAHOO_AUTH_ERROR' } satisfies Partial<YahooClientError>);
    expect(error.message).toBe("YAHOO_AUTH_ERROR: Flaim couldn't load the Yahoo connection right now. Try again later.");
  });

  it('does not reconnect for an unusable Yahoo token response shape, even though the code is refresh_failed', async () => {
    // Mirrors yahoo-connect-handlers.ts ~1169-1182: Yahoo returned a response
    // that parsed but had no usable token fields. Also carries no upstream_status.
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_failed',
          error_description: 'Failed to refresh access token',
        }),
        { status: 401 }
      )
    );

    const error = await getYahooCredentials(env, 'Bearer token').catch((e) => e) as YahooClientError;
    expect(error).toMatchObject({ code: 'YAHOO_AUTH_ERROR' } satisfies Partial<YahooClientError>);
    expect(error.message).toBe("YAHOO_AUTH_ERROR: Flaim couldn't load the Yahoo connection right now. Try again later.");
  });

  it('does not reconnect for a refresh_failed whose upstream_status is not a grant rejection (400/401)', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_failed',
          error_description: 'Yahoo returned an unexpected error',
          upstream_status: 403,
        }),
        { status: 401 }
      )
    );

    const error = await getYahooCredentials(env, 'Bearer token').catch((e) => e) as YahooClientError;
    expect(error).toMatchObject({ code: 'YAHOO_AUTH_ERROR' } satisfies Partial<YahooClientError>);
    expect(error.message).toBe("YAHOO_AUTH_ERROR: Flaim couldn't load the Yahoo connection right now. Try again later.");
  });

  it('also sends the reconnect message on an app fingerprint mismatch', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: YahooAuthWorkerErrorCode.APP_FINGERPRINT_MISMATCH,
          error_description: 'Stored Yahoo tokens were issued by a different Yahoo app.',
        }),
        { status: 401 }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toMatchObject({
      code: 'YAHOO_AUTH_ERROR',
      message: expect.stringContaining('Reconnect Yahoo'),
    } satisfies Partial<YahooClientError>);
  });

  it('does not send reconnect guidance for a server-side auth-worker exception', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'server_error',
          error_description: 'Failed to retrieve credentials',
        }),
        { status: 500 }
      )
    );

    const error = await getYahooCredentials(env, 'Bearer token').catch((e) => e) as YahooClientError;
    expect(error).toMatchObject({ code: 'YAHOO_AUTH_ERROR', status: 500 } satisfies Partial<YahooClientError>);
    expect(error.message).toBe("YAHOO_AUTH_ERROR: Flaim couldn't load the Yahoo connection right now. Try again later.");
  });

  it('does not send reconnect guidance for an internal-auth failure between workers', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'unauthorized',
          error_description: 'Authentication required',
        }),
        { status: 401 }
      )
    );

    const error = await getYahooCredentials(env, 'Bearer token').catch((e) => e) as YahooClientError;
    expect(error).toMatchObject({ code: 'YAHOO_AUTH_ERROR', status: 401 } satisfies Partial<YahooClientError>);
    expect(error.message).toBe("YAHOO_AUTH_ERROR: Flaim couldn't load the Yahoo connection right now. Try again later.");
  });

  it('logs only the auth-worker error code, never the free-form upstream description (FLA-363)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_failed',
          error_description: 'super secret upstream detail that must not be logged',
        }),
        { status: 401 }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toBeTruthy();

    for (const call of errorSpy.mock.calls) {
      expect(call.join(' ')).not.toContain('super secret upstream detail');
    }
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('refresh_failed'));
    errorSpy.mockRestore();
  });

  it('classifies a genuine Yahoo grant rejection while resolving Yahoo team keys', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_failed',
          error_description: 'invalid_grant: Refresh token expired',
          upstream_status: 400,
        }),
        { status: 401 }
      )
    );

    await expect(resolveUserTeamKey(env, '461.l.12345', 'Bearer token')).rejects.toMatchObject({
      code: 'YAHOO_AUTH_ERROR',
      message: expect.stringContaining('Reconnect Yahoo'),
    } satisfies Partial<YahooClientError>);
  });

  it('classifies 503 auth-worker failures as temporarily unavailable', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'server_timeout',
          error_description: 'Yahoo token refresh is temporarily unavailable',
        }),
        { status: 503 }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toThrow(
      'YAHOO_AUTH_UNAVAILABLE: server_timeout: Yahoo token refresh is temporarily unavailable'
    );
  });

  it('classifies retryable auth-worker failures as temporarily unavailable', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'upstream_busy',
          error_description: 'Try again later',
          retryable: true,
        }),
        { status: 502 }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toThrow(
      'YAHOO_AUTH_UNAVAILABLE: upstream_busy: Try again later'
    );
  });

  it('preserves auth-worker retry metadata on transient failures', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_temporarily_unavailable',
          error_description: 'Try again later',
          retryable: true,
          retry_after: 120,
          upstream_status: 429,
        }),
        { status: 503, headers: { 'Retry-After': '120' } }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toMatchObject({
      code: 'YAHOO_AUTH_UNAVAILABLE',
      status: 503,
      upstreamStatus: 429,
      retryable: true,
      retryAfter: 120,
    } satisfies Partial<YahooClientError>);
  });

  it('prefers Retry-After header over body retry_after on transient failures', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_temporarily_unavailable',
          error_description: 'Try again later',
          retryable: true,
          retry_after: 120,
        }),
        { status: 503, headers: { 'Retry-After': '30' } }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toMatchObject({
      code: 'YAHOO_AUTH_UNAVAILABLE',
      status: 503,
      retryable: true,
      retryAfter: 30,
    } satisfies Partial<YahooClientError>);
  });

  it('classifies known transient Yahoo auth codes while resolving team keys', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_temporarily_unavailable',
          error_description: 'Try again later',
        }),
        { status: 400 }
      )
    );

    await expect(resolveUserTeamKey(env, '461.l.12345', 'Bearer token')).rejects.toThrow(
      'YAHOO_AUTH_UNAVAILABLE: refresh_temporarily_unavailable: Try again later'
    );
  });

  it('returns null when Yahoo team key resolution receives a 404', async () => {
    mockAuthWorkerFetch.mockResolvedValue(new Response(null, { status: 404 }));

    await expect(resolveUserTeamKey(env, '461.l.12345', 'Bearer token')).resolves.toBeNull();
  });

  it('returns the persisted Yahoo team key for the requested league', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          leagues: [
            { leagueKey: '461.l.99999', teamKey: '461.l.99999.t.9' },
            { leagueKey: '461.l.12345', teamKey: '461.l.12345.t.4' },
          ],
        }),
        { status: 200 }
      )
    );

    await expect(resolveUserTeamKey(env, '461.l.12345', 'Bearer token')).resolves.toBe(
      '461.l.12345.t.4'
    );
  });
});
