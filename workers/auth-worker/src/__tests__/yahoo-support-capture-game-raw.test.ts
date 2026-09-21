import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../yahoo-storage', async () => {
  const actual = await vi.importActual<typeof import('../yahoo-storage')>('../yahoo-storage');
  return { ...actual, YahooStorage: { ...actual.YahooStorage, fromEnvironment: vi.fn() } };
});

import {
  captureYahooGameRawForSupport,
  YAHOO_SUPPORT_RAW_CAPTURE_MAX_BYTES,
  type YahooConnectEnv,
} from '../yahoo-connect-handlers';
import { runYahooSupportGameRawCapture } from '../yahoo-support-diagnostics';
import { YahooStorage } from '../yahoo-storage';

const USER_ID = 'user_3Ie4m68lUbzxyv22NsMU';
const GAME_KEY = '470';
const ACCESS_TOKEN = 'capture-access-token';
const REFRESH_TOKEN = 'capture-refresh-token';
const env: YahooConnectEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  YAHOO_CLIENT_ID: 'test-client',
  YAHOO_CLIENT_SECRET: 'test-secret',
  ENVIRONMENT: 'test',
};

let storage: { getYahooCredentials: ReturnType<typeof vi.fn> };
let fetchSpy: ReturnType<typeof vi.fn>;

function credentials() {
  return {
    clerkUserId: USER_ID,
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    needsRefresh: false,
  };
}

beforeEach(() => {
  storage = { getYahooCredentials: vi.fn().mockResolvedValue(credentials()) };
  vi.mocked(YahooStorage.fromEnvironment).mockReturnValue(storage as never);
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('captureYahooGameRawForSupport', () => {
  it('returns one non-2xx Yahoo response byte-for-byte with a digest', async () => {
    const source = new Uint8Array([0x7b, 0x22, 0x6e, 0x61, 0x6d, 0x65, 0x22, 0x3a, 0xc3, 0xa9, 0x7d]);
    fetchSpy.mockResolvedValue(new Response(source, { status: 503 }));

    const result = await captureYahooGameRawForSupport(env, USER_ID, GAME_KEY, 'test-correlation-id');

    expect(result).toMatchObject({
      status: 'captured',
      upstreamStatus: 503,
      byteLength: source.byteLength,
      sha256: '17f4bd28ea95eab0396b86d3e0bfe8812a1f31f3d09feaa3e01a14ed7641af91',
    });
    if (result.status === 'captured') expect([...result.body]).toEqual([...source]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=470/leagues;out=teams?format=json',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
        redirect: 'error',
      }),
    );
    expect(storage.getYahooCredentials).toHaveBeenCalledTimes(2);
  });

  it('refuses a response whose declared length exceeds the fixed cap before reading it', async () => {
    fetchSpy.mockResolvedValue(new Response('not-read', {
      status: 200,
      headers: { 'content-length': String(YAHOO_SUPPORT_RAW_CAPTURE_MAX_BYTES + 1) },
    }));

    const result = await captureYahooGameRawForSupport(env, USER_ID, GAME_KEY);

    expect(result).toEqual({
      status: 'too_large',
      upstreamStatus: 200,
      byteLength: YAHOO_SUPPORT_RAW_CAPTURE_MAX_BYTES + 1,
    });
    expect(storage.getYahooCredentials).toHaveBeenCalledTimes(1);
  });

  it('enforces the same cap when Yahoo omits Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(YAHOO_SUPPORT_RAW_CAPTURE_MAX_BYTES + 1));
        controller.close();
      },
    });
    fetchSpy.mockResolvedValue(new Response(stream, { status: 200 }));

    const result = await captureYahooGameRawForSupport(env, USER_ID, GAME_KEY);

    expect(result).toEqual({
      status: 'too_large',
      upstreamStatus: 200,
      byteLength: YAHOO_SUPPORT_RAW_CAPTURE_MAX_BYTES + 1,
    });
    expect(storage.getYahooCredentials).toHaveBeenCalledTimes(1);
  });

  it('refuses exact token bytes without exposing them', async () => {
    fetchSpy.mockResolvedValue(new Response(`prefix ${REFRESH_TOKEN} suffix`, { status: 200 }));

    const result = await captureYahooGameRawForSupport(env, USER_ID, GAME_KEY);

    expect(result).toEqual({
      status: 'token_detected',
      upstreamStatus: 200,
      byteLength: `prefix ${REFRESH_TOKEN} suffix`.length,
    });
    expect(JSON.stringify(result)).not.toContain(REFRESH_TOKEN);
  });

  it('rejects a non-numeric game key before storage or Yahoo calls', async () => {
    await expect(captureYahooGameRawForSupport(env, USER_ID, '../470')).rejects.toThrow('invalid game key');

    expect(storage.getYahooCredentials).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('logs only the closed capture audit fields', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const capturedBytes = new TextEncoder().encode(`private ${ACCESS_TOKEN} is not logged`);

    const report = await runYahooSupportGameRawCapture(
      env,
      { userId: USER_ID, gameKey: GAME_KEY },
      {
        now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(145),
        capture: vi.fn().mockResolvedValue({
          status: 'captured',
          body: capturedBytes,
          upstreamStatus: 418,
          byteLength: capturedBytes.byteLength,
          sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        }),
      },
    );

    expect(report.outcome).toBe('captured');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const audit = JSON.parse(String(logSpy.mock.calls[0][0]));
    expect(audit).toMatchObject({
      event: 'yahoo_support_capture_game_raw',
      user_id: 'user_3Ie...',
      outcome: 'captured',
      upstream_status: 418,
      bytes: capturedBytes.byteLength,
      duration_ms: 45,
    });
    expect(Object.keys(audit).sort()).toEqual([
      'bytes',
      'correlation_id',
      'duration_ms',
      'event',
      'outcome',
      'upstream_status',
      'user_id',
    ]);
    expect(JSON.stringify(audit)).not.toContain(ACCESS_TOKEN);
  });
});
