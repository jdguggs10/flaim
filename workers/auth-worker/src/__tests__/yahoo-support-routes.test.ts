import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../yahoo-support-diagnostics', async () => {
  const actual = await vi.importActual<typeof import('../yahoo-support-diagnostics')>(
    '../yahoo-support-diagnostics'
  );
  return {
    ...actual,
    // Spy that still runs the real validator, so these route tests exercise
    // request validation end-to-end while asserting it never runs before the
    // two auth gates have passed.
    parseYahooSupportRequest: vi.fn(actual.parseYahooSupportRequest),
    // Business logic is stubbed here: these tests own routing, auth and
    // status mapping. The snapshot itself is covered by
    // yahoo-support-inspect.test.ts.
    runYahooSupportInspect: vi.fn(),
  };
});

vi.mock('../oauth-handlers', async () => {
  const actual = await vi.importActual<typeof import('../oauth-handlers')>('../oauth-handlers');
  return {
    ...actual,
    validateOAuthToken: vi.fn().mockResolvedValue(null),
  };
});

import app from '../index-hono';
import { validateOAuthToken } from '../oauth-handlers';
import {
  parseYahooSupportRequest,
  runYahooSupportInspect,
  type YahooSupportInspectReport,
} from '../yahoo-support-diagnostics';

const INSPECT_PATH = '/auth/internal/support/yahoo/inspect';

const SUPPORT_PATHS = [
  INSPECT_PATH,
  '/auth/internal/support/yahoo/diagnose',
  '/auth/internal/support/yahoo/refresh',
] as const;

// Diagnose and refresh are still Session-1 stubs; inspect is implemented.
const STUB_PATHS = SUPPORT_PATHS.filter((path) => path !== INSPECT_PATH);

const INSPECT_OK_REPORT: YahooSupportInspectReport = {
  outcome: 'ok',
  userMasked: 'user_3Ie...',
  checkedAt: '2026-09-09T15:00:00.000Z',
  providers: { yahoo: true, espn: false, sleeper: false },
  yahooCredential: { connected: false, hasCredentials: false },
  yahooLeagues: { rowCount: 0, distinctSeasons: 0, oldestUpdatedAt: null, newestUpdatedAt: null },
  sync: [],
  flaimSessions: { activeCount: 0, mostRecentExpiresAt: null, clientNames: [] },
};

const ISSUER = 'https://flaim-test.clerk.accounts.dev';
const KEY_ID = 'yahoo-support-routes-test-key';
const INTERNAL_SERVICE_TOKEN = 'internal-support-secret';
const SUPPORT_TOOL_TOKEN = 'support-tool-secret';
const EVAL_API_KEY = 'flaim_eval_support_routes_test';
const EVAL_USER_ID = 'user_eval_support';
const DEMO_API_KEY = 'flaim_demo_support_routes_test';
const DEMO_USER_ID = 'user_demo_support';
const TARGET_USER_ID = 'user_3Ie4m68lUbzxyv22NsMU';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
  CLERK_ISSUER: ISSUER,
  EVAL_API_KEY,
  EVAL_USER_ID,
  DEMO_API_KEY,
  DEMO_USER_ID,
  INTERNAL_SERVICE_TOKEN,
  SUPPORT_TOOL_TOKEN,
  TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CREDENTIALS_RATE_LIMITER: { limit: async () => ({ success: true }) },
  WEBHOOK_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

type TestJwk = JsonWebKey & { kid: string; alg: string; use: string };

let privateKey: CryptoKey;
let publicJwk: TestJwk;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signedClerkToken(sub = 'user_support_route_caller'): Promise<string> {
  const header = base64UrlJson({ alg: 'RS256', kid: KEY_ID, typ: 'JWT' });
  const payload = base64UrlJson({
    sub,
    iss: ISSUER,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const data = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(data),
  );
  return `${data}.${base64Url(new Uint8Array(signature))}`;
}

function makeRequest(
  path: string,
  headers: Record<string, string> = {},
  body: string = JSON.stringify({ userId: TARGET_USER_ID }),
  method = 'POST',
): Request {
  return new Request(`https://api.flaim.app${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(method === 'GET' ? {} : { body }),
  });
}

function bothTokens(): Record<string, string> {
  return {
    'X-Flaim-Internal-Token': INTERNAL_SERVICE_TOKEN,
    'X-Flaim-Support-Token': SUPPORT_TOOL_TOKEN,
  };
}

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  privateKey = keyPair.privateKey;
  const exported = await crypto.subtle.exportKey('jwk', keyPair.publicKey) as JsonWebKey;
  publicJwk = { ...exported, kid: KEY_ID, alg: 'RS256', use: 'sig' };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(validateOAuthToken).mockResolvedValue(null);
  vi.mocked(runYahooSupportInspect).mockResolvedValue(INSPECT_OK_REPORT);
  // Clerk JWKS lookup — the only network call these tests can trigger.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ keys: [publicJwk] }),
    { headers: { 'content-type': 'application/json' } },
  )));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(SUPPORT_PATHS)('POST %s', (path) => {
  it('rejects a request with neither service header', async () => {
    const res = await app.fetch(makeRequest(path), baseEnv);

    expect(res.status).toBe(403);
    expect(parseYahooSupportRequest).not.toHaveBeenCalled();
  });

  // The whole point of the second secret: holding the widely-shared internal
  // service token is not enough to target an arbitrary account.
  it('rejects a valid internal token with no support token', async () => {
    const res = await app.fetch(
      makeRequest(path, { 'X-Flaim-Internal-Token': INTERNAL_SERVICE_TOKEN }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Missing or invalid X-Flaim-Support-Token',
    });
    expect(parseYahooSupportRequest).not.toHaveBeenCalled();
  });

  it('rejects a valid support token with no internal token', async () => {
    const res = await app.fetch(
      makeRequest(path, { 'X-Flaim-Support-Token': SUPPORT_TOOL_TOKEN }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Missing or invalid X-Flaim-Internal-Token',
    });
    expect(parseYahooSupportRequest).not.toHaveBeenCalled();
  });

  it('rejects a valid support token with an incorrect internal token', async () => {
    const res = await app.fetch(
      makeRequest(path, {
        'X-Flaim-Internal-Token': 'wrong-internal-token',
        'X-Flaim-Support-Token': SUPPORT_TOOL_TOKEN,
      }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    expect(parseYahooSupportRequest).not.toHaveBeenCalled();
  });

  it('rejects a valid internal token with an incorrect support token', async () => {
    const res = await app.fetch(
      makeRequest(path, {
        'X-Flaim-Internal-Token': INTERNAL_SERVICE_TOKEN,
        'X-Flaim-Support-Token': 'wrong-support-token',
      }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    expect(parseYahooSupportRequest).not.toHaveBeenCalled();
  });

  it('fails closed when INTERNAL_SERVICE_TOKEN is unconfigured', async () => {
    const res = await app.fetch(
      makeRequest(path, bothTokens()),
      { ...baseEnv, INTERNAL_SERVICE_TOKEN: undefined },
    );

    expect(res.status).toBe(500);
    expect(parseYahooSupportRequest).not.toHaveBeenCalled();
  });

  it('fails closed when SUPPORT_TOOL_TOKEN is unconfigured', async () => {
    const res = await app.fetch(
      makeRequest(path, bothTokens()),
      { ...baseEnv, SUPPORT_TOOL_TOKEN: undefined },
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Support tool authentication is not configured',
    });
    expect(parseYahooSupportRequest).not.toHaveBeenCalled();
  });

  it('rejects a valid Clerk session JWT with no support token', async () => {
    const token = await signedClerkToken();
    const res = await app.fetch(
      makeRequest(path, { Authorization: `Bearer ${token}` }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    expect(parseYahooSupportRequest).not.toHaveBeenCalled();
  });

  it('rejects the static eval API key with no support token', async () => {
    const res = await app.fetch(
      makeRequest(path, { Authorization: `Bearer ${EVAL_API_KEY}` }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    expect(parseYahooSupportRequest).not.toHaveBeenCalled();
  });

  it('rejects a valid MCP OAuth bearer token with no support token', async () => {
    vi.mocked(validateOAuthToken).mockResolvedValue({
      userId: 'user_oauth_support',
      scope: 'mcp:read mcp:write',
      clientName: 'ChatGPT',
    });

    const res = await app.fetch(
      makeRequest(path, { Authorization: 'Bearer mcp-oauth-access-token' }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    expect(parseYahooSupportRequest).not.toHaveBeenCalled();
  });

  it('reaches the handler with both secrets and a valid body', async () => {
    const res = await app.fetch(makeRequest(path, bothTokens()), baseEnv);

    // Past both gates and through validation. What the handler then answers is
    // per-route and asserted below.
    expect([403, 500]).not.toContain(res.status);
    await expect(res.json()).resolves.toHaveProperty('outcome');
    expect(parseYahooSupportRequest).toHaveBeenCalledTimes(1);
  });

  it('returns a validation error with both secrets and a malformed userId', async () => {
    const res = await app.fetch(
      makeRequest(path, bothTokens(), JSON.stringify({ userId: 'admin' })),
      baseEnv,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_user_id' });
    expect(parseYahooSupportRequest).toHaveBeenCalledTimes(1);
  });

  // Ordering guard: with a bad token AND a bad body the caller must see the
  // auth failure, proving the gates run before anything reads the body.
  it('checks authentication before request validation', async () => {
    const res = await app.fetch(
      makeRequest(
        path,
        { 'X-Flaim-Internal-Token': 'wrong-internal-token', 'X-Flaim-Support-Token': SUPPORT_TOOL_TOKEN },
        JSON.stringify({ userId: 'admin' }),
      ),
      baseEnv,
    );

    expect(res.status).toBe(403);
    expect(parseYahooSupportRequest).not.toHaveBeenCalled();
  });

  it('is not exposed over GET', async () => {
    const res = await app.fetch(makeRequest(path, bothTokens(), '', 'GET'), baseEnv);

    expect([404, 405]).toContain(res.status);
    expect(parseYahooSupportRequest).not.toHaveBeenCalled();
  });
});

// Unchanged from Session 1: these two routes are still unimplemented stubs.
describe.each(STUB_PATHS)('POST %s (unimplemented stub)', (path) => {
  it('answers 501 once both secrets and the body validate', async () => {
    const res = await app.fetch(makeRequest(path, bothTokens()), baseEnv);

    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toEqual({ outcome: 'not_implemented' });
    expect(runYahooSupportInspect).not.toHaveBeenCalled();
  });
});

describe(`POST ${INSPECT_PATH} (implemented)`, () => {
  it('runs the inspect snapshot and returns the report verbatim', async () => {
    const res = await app.fetch(makeRequest(INSPECT_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(INSPECT_OK_REPORT);
    expect(runYahooSupportInspect).toHaveBeenCalledTimes(1);
    expect(runYahooSupportInspect).toHaveBeenCalledWith(
      expect.objectContaining({ SUPABASE_URL: baseEnv.SUPABASE_URL }),
      { userId: TARGET_USER_ID },
    );
  });

  it('maps a failed snapshot to 500 without inventing an error body', async () => {
    const failed = { outcome: 'failed', userMasked: 'user_3Ie...', error: 'snapshot_failed' } as const;
    vi.mocked(runYahooSupportInspect).mockResolvedValue(failed);

    const res = await app.fetch(makeRequest(INSPECT_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual(failed);
  });

  it('does not run the snapshot when the body fails validation', async () => {
    const res = await app.fetch(
      makeRequest(INSPECT_PATH, bothTokens(), JSON.stringify({ userId: 'admin' })),
      baseEnv,
    );

    expect(res.status).toBe(400);
    expect(runYahooSupportInspect).not.toHaveBeenCalled();
  });

  it('does not run the snapshot when authentication fails', async () => {
    const res = await app.fetch(
      makeRequest(INSPECT_PATH, { 'X-Flaim-Internal-Token': INTERNAL_SERVICE_TOKEN }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    expect(runYahooSupportInspect).not.toHaveBeenCalled();
  });
});

describe('Clerk JWT fixture', () => {
  // Guards the "a valid Clerk JWT alone is still 403" cases above: if the
  // fixture stopped being a genuinely valid session token those tests would
  // pass for the wrong reason.
  it('authenticates on a Clerk-protected route', async () => {
    const token = await signedClerkToken();
    const res = await app.fetch(
      makeRequest('/auth/leagues/refresh', { Authorization: `Bearer ${token}` },
        JSON.stringify({ platforms: ['bad-platform'] })),
      baseEnv,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'unknown_platform' });
  });
});
