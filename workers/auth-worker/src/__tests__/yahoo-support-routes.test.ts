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
    parseYahooSupportLeagueRequest: vi.fn(actual.parseYahooSupportLeagueRequest),
    parseYahooSupportLeagueMembershipRequest: vi.fn(actual.parseYahooSupportLeagueMembershipRequest),
    parseYahooSupportLeagueRecoveryRequest: vi.fn(actual.parseYahooSupportLeagueRecoveryRequest),
    parseYahooSupportTeamNameLeagueLocationRequest: vi.fn(actual.parseYahooSupportTeamNameLeagueLocationRequest),
    parseYahooSupportGameRawCaptureRequest: vi.fn(actual.parseYahooSupportGameRawCaptureRequest),
    // Business logic is stubbed here: these tests own routing, auth and
    // status mapping. The snapshot itself is covered by
    // yahoo-support-inspect.test.ts, the diagnosis by
    // yahoo-support-diagnose.test.ts, the refresh by
    // yahoo-support-refresh.test.ts, and the league probe by
    // yahoo-support-probe-league.test.ts.
    runYahooSupportInspect: vi.fn(),
    runYahooSupportDiagnose: vi.fn(),
    runYahooSupportProbeLeague: vi.fn(),
    runYahooSupportRecoverLeague: vi.fn(),
    runYahooSupportLocateLeagueByTeamName: vi.fn(),
    runYahooSupportGameRawCapture: vi.fn(),
    runYahooSupportRefresh: vi.fn(),
    runYahooSupportVerifyLeagueMembership: vi.fn(),
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
  parseYahooSupportLeagueRequest,
  parseYahooSupportLeagueMembershipRequest,
  parseYahooSupportLeagueRecoveryRequest,
  parseYahooSupportTeamNameLeagueLocationRequest,
  parseYahooSupportGameRawCaptureRequest,
  parseYahooSupportRequest,
  runYahooSupportDiagnose,
  runYahooSupportInspect,
  runYahooSupportProbeLeague,
  runYahooSupportRecoverLeague,
  runYahooSupportLocateLeagueByTeamName,
  runYahooSupportGameRawCapture,
  runYahooSupportRefresh,
  runYahooSupportVerifyLeagueMembership,
  type YahooSupportDiagnoseReport,
  type YahooSupportInspectReport,
  type YahooSupportProbeLeagueReport,
  type YahooSupportRefreshReport,
  type YahooSupportLeagueMembershipReport,
  type YahooSupportLeagueRecoveryReport,
  type YahooSupportTeamNameLeagueLocationReport,
  type YahooSupportGameRawCaptureReport,
} from '../yahoo-support-diagnostics';

const INSPECT_PATH = '/auth/internal/support/yahoo/inspect';
const DIAGNOSE_PATH = '/auth/internal/support/yahoo/diagnose';
const PROBE_LEAGUE_PATH = '/auth/internal/support/yahoo/probe-league';
const VERIFY_LEAGUE_MEMBERSHIP_PATH = '/auth/internal/support/yahoo/verify-league-membership';
const RECOVER_LEAGUE_PATH = '/auth/internal/support/yahoo/recover-league';
const LOCATE_LEAGUE_BY_TEAM_NAME_PATH = '/auth/internal/support/yahoo/locate-league';
const CAPTURE_GAME_RAW_PATH = '/auth/internal/support/yahoo/capture-game-raw';
const REFRESH_PATH = '/auth/internal/support/yahoo/refresh';

// All seven actions are implemented; no stub route remains.
const SUPPORT_PATHS = [INSPECT_PATH, DIAGNOSE_PATH, PROBE_LEAGUE_PATH, VERIFY_LEAGUE_MEMBERSHIP_PATH, LOCATE_LEAGUE_BY_TEAM_NAME_PATH, CAPTURE_GAME_RAW_PATH, RECOVER_LEAGUE_PATH, REFRESH_PATH] as const;

/**
 * probe-league is the one route with its own body shape and its own parser, so
 * the shared gate suite below asks each path which of the two it should be
 * asserting on rather than assuming one.
 */
function parserFor(path: string) {
  if (path === PROBE_LEAGUE_PATH) return parseYahooSupportLeagueRequest;
  if (path === VERIFY_LEAGUE_MEMBERSHIP_PATH) return parseYahooSupportLeagueMembershipRequest;
  if (path === RECOVER_LEAGUE_PATH) return parseYahooSupportLeagueRecoveryRequest;
  if (path === LOCATE_LEAGUE_BY_TEAM_NAME_PATH) return parseYahooSupportTeamNameLeagueLocationRequest;
  if (path === CAPTURE_GAME_RAW_PATH) return parseYahooSupportGameRawCaptureRequest;
  return parseYahooSupportRequest;
}

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

const DIAGNOSE_OK_REPORT: YahooSupportDiagnoseReport = {
  outcome: 'ok',
  userMasked: 'user_3Ie...',
  checkedAt: '2026-09-09T15:00:00.000Z',
  correlationId: '11111111-2222-3333-4444-555555555555',
  diagnosis: { stage: 'not_connected' },
  interpretation: {
    category: 'not_connected',
    summary: 'This account has no stored Yahoo credential row, so there is nothing for Flaim to sync from.',
    nextAction: 'Ask the customer to connect Yahoo from the Flaim web app, then re-run inspect.',
  },
};

const PROBE_LEAGUE_OK_REPORT: YahooSupportProbeLeagueReport = {
  outcome: 'ok',
  userMasked: 'user_3Ie...',
  checkedAt: '2026-09-09T15:00:00.000Z',
  correlationId: '11111111-2222-3333-4444-555555555555',
  call: {
    label: 'league_teams',
    httpStatus: 400,
    ok: false,
    bodyIsJson: true,
    bodyLooksLikeEnvelope: false,
    errorSnippetCategory: 'yahoo_error_json',
    durationMs: 118,
  },
  interpretation: {
    category: 'yahoo_rejected',
    summary: 'Yahoo refused this exact league request (HTTP 400) with an error body of its own.',
    nextAction: 'File a bug with the category and the error description below.',
    errorDescription: 'Invalid game key provided - 153104',
  },
};

const VERIFY_LEAGUE_MEMBERSHIP_OK_REPORT: YahooSupportLeagueMembershipReport = {
  outcome: 'ok',
  userMasked: 'user_3Ie...',
  checkedAt: '2026-09-09T15:00:00.000Z',
  correlationId: '11111111-2222-3333-4444-555555555555',
  collection: 'contains_requested_team',
  calls: [
    { label: 'league_teams', httpStatus: 200, ok: true, bodyIsJson: true, bodyLooksLikeEnvelope: true, errorSnippetCategory: 'none', durationMs: 12 },
    { label: 'user_game_teams', httpStatus: 200, ok: true, bodyIsJson: true, bodyLooksLikeEnvelope: true, errorSnippetCategory: 'none', durationMs: 13 },
  ],
  interpretation: {
    category: 'membership_confirmed_collection_present',
    summary: 'Yahoo confirms membership.',
    nextAction: 'Investigate discovery.',
  },
};

const RECOVER_LEAGUE_OK_REPORT: YahooSupportLeagueRecoveryReport = {
  outcome: 'ok',
  userMasked: 'user_3Ie...',
  checkedAt: '2026-09-09T15:00:00.000Z',
  correlationId: '11111111-2222-3333-4444-555555555555',
  result: { status: 'persisted_visible' },
};

const LOCATE_LEAGUE_BY_TEAM_NAME_OK_REPORT: YahooSupportTeamNameLeagueLocationReport = {
  outcome: 'ok',
  userMasked: 'user_3Ie...',
  checkedAt: '2026-09-09T15:00:00.000Z',
  correlationId: '11111111-2222-3333-4444-555555555555',
  result: { status: 'unique', leagueKey: '470.l.1234567' },
};

const CAPTURE_GAME_RAW_OK_REPORT: YahooSupportGameRawCaptureReport = {
  outcome: 'captured',
  correlationId: '11111111-2222-3333-4444-555555555555',
  capture: {
    status: 'captured',
    body: new TextEncoder().encode('{"sentinel":true}'),
    upstreamStatus: 503,
    byteLength: 17,
    sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
};

const REFRESH_OK_REPORT: YahooSupportRefreshReport = {
  outcome: 'ok',
  userMasked: 'user_3Ie...',
  correlationId: '11111111-2222-3333-4444-555555555555',
  before: { leagueRows: 0, sync: null },
  provider: { status: 'success', httpStatus: 200, leagueCount: 4, stopReason: null },
  after: { leagueRows: 4, sync: null },
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
const TARGET_LEAGUE_ID = '153104';
const TARGET_LEAGUE_KEY = '470.l.1234567';
const TARGET_GAME_KEY = '470';
const TARGET_TEAM_NAME_SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** The smallest valid body for each route. Only probe-league takes a second field. */
function validBodyFor(path: string): string {
  if (path === PROBE_LEAGUE_PATH) return JSON.stringify({ userId: TARGET_USER_ID, leagueId: TARGET_LEAGUE_ID });
  if (path === VERIFY_LEAGUE_MEMBERSHIP_PATH || path === RECOVER_LEAGUE_PATH) return JSON.stringify({ userId: TARGET_USER_ID, leagueKey: TARGET_LEAGUE_KEY });
  if (path === LOCATE_LEAGUE_BY_TEAM_NAME_PATH) return JSON.stringify({ userId: TARGET_USER_ID, gameKey: TARGET_GAME_KEY, teamNameSha256: TARGET_TEAM_NAME_SHA256 });
  if (path === CAPTURE_GAME_RAW_PATH) return JSON.stringify({ userId: TARGET_USER_ID, gameKey: TARGET_GAME_KEY });
  return JSON.stringify({ userId: TARGET_USER_ID });
}

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
  body: string = validBodyFor(path),
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
  vi.mocked(runYahooSupportDiagnose).mockResolvedValue(DIAGNOSE_OK_REPORT);
  vi.mocked(runYahooSupportProbeLeague).mockResolvedValue(PROBE_LEAGUE_OK_REPORT);
  vi.mocked(runYahooSupportRecoverLeague).mockResolvedValue(RECOVER_LEAGUE_OK_REPORT);
  vi.mocked(runYahooSupportLocateLeagueByTeamName).mockResolvedValue(LOCATE_LEAGUE_BY_TEAM_NAME_OK_REPORT);
  vi.mocked(runYahooSupportGameRawCapture).mockResolvedValue(CAPTURE_GAME_RAW_OK_REPORT);
  vi.mocked(runYahooSupportRefresh).mockResolvedValue(REFRESH_OK_REPORT);
  vi.mocked(runYahooSupportVerifyLeagueMembership).mockResolvedValue(VERIFY_LEAGUE_MEMBERSHIP_OK_REPORT);
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
    expect(parserFor(path)).not.toHaveBeenCalled();
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
    expect(parserFor(path)).not.toHaveBeenCalled();
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
    expect(parserFor(path)).not.toHaveBeenCalled();
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
    expect(parserFor(path)).not.toHaveBeenCalled();
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
    expect(parserFor(path)).not.toHaveBeenCalled();
  });

  it('fails closed when INTERNAL_SERVICE_TOKEN is unconfigured', async () => {
    const res = await app.fetch(
      makeRequest(path, bothTokens()),
      { ...baseEnv, INTERNAL_SERVICE_TOKEN: undefined },
    );

    expect(res.status).toBe(500);
    expect(parserFor(path)).not.toHaveBeenCalled();
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
    expect(parserFor(path)).not.toHaveBeenCalled();
  });

  it('rejects a valid Clerk session JWT with no support token', async () => {
    const token = await signedClerkToken();
    const res = await app.fetch(
      makeRequest(path, { Authorization: `Bearer ${token}` }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    expect(parserFor(path)).not.toHaveBeenCalled();
  });

  it('rejects the static eval API key with no support token', async () => {
    const res = await app.fetch(
      makeRequest(path, { Authorization: `Bearer ${EVAL_API_KEY}` }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    expect(parserFor(path)).not.toHaveBeenCalled();
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
    expect(parserFor(path)).not.toHaveBeenCalled();
  });

  it('reaches the handler with both secrets and a valid body', async () => {
    const res = await app.fetch(makeRequest(path, bothTokens()), baseEnv);

    // Past both gates and through validation. What the handler then answers is
    // per-route and asserted below.
    expect([403, 500]).not.toContain(res.status);
    if (path === CAPTURE_GAME_RAW_PATH) {
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Flaim-Support-Capture')).toBe('yahoo-game-raw-v1');
    } else {
      await expect(res.json()).resolves.toHaveProperty('outcome');
    }
    expect(parserFor(path)).toHaveBeenCalledTimes(1);
  });

  it('returns a validation error with both secrets and a malformed userId', async () => {
    const res = await app.fetch(
      makeRequest(path, bothTokens(), JSON.stringify({ userId: 'admin' })),
      baseEnv,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_user_id' });
    expect(parserFor(path)).toHaveBeenCalledTimes(1);
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
    expect(parserFor(path)).not.toHaveBeenCalled();
  });

  it('is not exposed over GET', async () => {
    const res = await app.fetch(makeRequest(path, bothTokens(), '', 'GET'), baseEnv);

    expect([404, 405]).toContain(res.status);
    expect(parserFor(path)).not.toHaveBeenCalled();
  });
});

// No support route answers the Session-1 stub any more.
describe.each(SUPPORT_PATHS)('POST %s (no stub remains)', (path) => {
  it('does not answer 501 once both secrets and the body validate', async () => {
    const res = await app.fetch(makeRequest(path, bothTokens()), baseEnv);

    expect(res.status).not.toBe(501);
    if (path !== CAPTURE_GAME_RAW_PATH) {
      await expect(res.json()).resolves.not.toMatchObject({ outcome: 'not_implemented' });
    }
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

  // Deliberate: inspect is pure explicit-column DB reads, never touches
  // Yahoo, and never writes — unlike diagnose/refresh it carries no budget
  // to protect, so it is not rate-limited.
  it('is not rate-limited even when the limiter would deny every key', async () => {
    const alwaysDenied = { ...baseEnv, CREDENTIALS_RATE_LIMITER: { limit: async () => ({ success: false }) } };

    const res = await app.fetch(makeRequest(INSPECT_PATH, bothTokens()), alwaysDenied);

    expect(res.status).toBe(200);
    expect(runYahooSupportInspect).toHaveBeenCalledTimes(1);
  });
});

describe(`POST ${DIAGNOSE_PATH} (implemented)`, () => {
  it('runs the real diagnosis instead of the Session-1 stub', async () => {
    const res = await app.fetch(makeRequest(DIAGNOSE_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(DIAGNOSE_OK_REPORT);
    expect(runYahooSupportDiagnose).toHaveBeenCalledTimes(1);
    expect(runYahooSupportDiagnose).toHaveBeenCalledWith(
      expect.objectContaining({ SUPABASE_URL: baseEnv.SUPABASE_URL }),
      { userId: TARGET_USER_ID },
    );
    expect(runYahooSupportInspect).not.toHaveBeenCalled();
  });

  it('maps a failed diagnostic to 500 without inventing an error body', async () => {
    const failed = { outcome: 'failed', userMasked: 'user_3Ie...', error: 'diagnostic_failed' } as const;
    vi.mocked(runYahooSupportDiagnose).mockResolvedValue(failed);

    const res = await app.fetch(makeRequest(DIAGNOSE_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual(failed);
  });

  it('does not run the diagnosis when the body fails validation', async () => {
    const res = await app.fetch(
      makeRequest(DIAGNOSE_PATH, bothTokens(), JSON.stringify({ userId: 'admin' })),
      baseEnv,
    );

    expect(res.status).toBe(400);
    expect(runYahooSupportDiagnose).not.toHaveBeenCalled();
  });

  it('does not run the diagnosis when authentication fails', async () => {
    const res = await app.fetch(
      makeRequest(DIAGNOSE_PATH, { 'X-Flaim-Internal-Token': INTERNAL_SERVICE_TOKEN }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    expect(runYahooSupportDiagnose).not.toHaveBeenCalled();
  });

  // Keyed on the action, not the target user id: rotating which account is
  // targeted must not let a caller evade the limit.
  it('rate-limits after the auth gate but before running the diagnosis', async () => {
    const limitedEnv = {
      ...baseEnv,
      CREDENTIALS_RATE_LIMITER: { limit: vi.fn(async ({ key }: { key: string }) => ({ success: key !== 'support:diagnose' })) },
    };

    const res = await app.fetch(makeRequest(DIAGNOSE_PATH, bothTokens()), limitedEnv);

    expect(res.status).toBe(429);
    expect(runYahooSupportDiagnose).not.toHaveBeenCalled();
  });

  it('does not rate-limit under the diagnose key when the internal token is wrong', async () => {
    const spy = vi.fn(async () => ({ success: true }));
    const env = { ...baseEnv, CREDENTIALS_RATE_LIMITER: { limit: spy } };

    const res = await app.fetch(
      makeRequest(DIAGNOSE_PATH, { 'X-Flaim-Internal-Token': 'wrong', 'X-Flaim-Support-Token': SUPPORT_TOOL_TOKEN }),
      env,
    );

    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe(`POST ${PROBE_LEAGUE_PATH} (implemented)`, () => {
  it('runs the league probe and returns the report verbatim', async () => {
    const res = await app.fetch(makeRequest(PROBE_LEAGUE_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(PROBE_LEAGUE_OK_REPORT);
    expect(runYahooSupportProbeLeague).toHaveBeenCalledTimes(1);
    expect(runYahooSupportProbeLeague).toHaveBeenCalledWith(
      expect.objectContaining({ SUPABASE_URL: baseEnv.SUPABASE_URL }),
      { userId: TARGET_USER_ID, leagueId: TARGET_LEAGUE_ID },
    );
    expect(runYahooSupportInspect).not.toHaveBeenCalled();
    expect(runYahooSupportDiagnose).not.toHaveBeenCalled();
    expect(runYahooSupportRefresh).not.toHaveBeenCalled();
  });

  it('maps a failed probe to 500 without inventing an error body', async () => {
    const failed = { outcome: 'failed', userMasked: 'user_3Ie...', error: 'probe_failed' } as const;
    vi.mocked(runYahooSupportProbeLeague).mockResolvedValue(failed);

    const res = await app.fetch(makeRequest(PROBE_LEAGUE_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual(failed);
  });

  // The field only this route accepts, and the one that reaches a Yahoo URL.
  it.each([
    ['missing', JSON.stringify({ userId: TARGET_USER_ID })],
    ['a path traversal', JSON.stringify({ userId: TARGET_USER_ID, leagueId: '../../users' })],
    ['a slash', JSON.stringify({ userId: TARGET_USER_ID, leagueId: '461/l/153104' })],
    ['a query parameter', JSON.stringify({ userId: TARGET_USER_ID, leagueId: '153104?format=xml' })],
    ['not a string', JSON.stringify({ userId: TARGET_USER_ID, leagueId: 153104 })],
  ])('rejects a %s leagueId without running the probe', async (_label, body) => {
    const res = await app.fetch(makeRequest(PROBE_LEAGUE_PATH, bothTokens(), body), baseEnv);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_league_id' });
    expect(runYahooSupportProbeLeague).not.toHaveBeenCalled();
  });

  it('accepts a full league key as readily as a bare numeric id', async () => {
    const res = await app.fetch(
      makeRequest(
        PROBE_LEAGUE_PATH,
        bothTokens(),
        JSON.stringify({ userId: TARGET_USER_ID, leagueId: '461.l.153104' }),
      ),
      baseEnv,
    );

    expect(res.status).toBe(200);
    expect(runYahooSupportProbeLeague).toHaveBeenCalledWith(
      expect.anything(),
      { userId: TARGET_USER_ID, leagueId: '461.l.153104' },
    );
  });

  it('does not run the probe when authentication fails', async () => {
    const res = await app.fetch(
      makeRequest(PROBE_LEAGUE_PATH, { 'X-Flaim-Internal-Token': INTERNAL_SERVICE_TOKEN }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    expect(runYahooSupportProbeLeague).not.toHaveBeenCalled();
  });

  // Its own limiter key: a burst of probes must not eat diagnose's budget, and
  // rotating the target account must not evade the limit.
  it('rate-limits independently of diagnose and refresh', async () => {
    const limitedEnv = {
      ...baseEnv,
      CREDENTIALS_RATE_LIMITER: { limit: vi.fn(async ({ key }: { key: string }) => ({ success: key !== 'support:probe-league' })) },
    };

    const res = await app.fetch(makeRequest(PROBE_LEAGUE_PATH, bothTokens()), limitedEnv);

    expect(res.status).toBe(429);
    expect(runYahooSupportProbeLeague).not.toHaveBeenCalled();

    const diagnoseRes = await app.fetch(makeRequest(DIAGNOSE_PATH, bothTokens()), limitedEnv);
    expect(diagnoseRes.status).toBe(200);
  });

  it('does not rate-limit under the probe key when the internal token is wrong', async () => {
    const spy = vi.fn(async () => ({ success: true }));
    const env = { ...baseEnv, CREDENTIALS_RATE_LIMITER: { limit: spy } };

    const res = await app.fetch(
      makeRequest(PROBE_LEAGUE_PATH, { 'X-Flaim-Internal-Token': 'wrong', 'X-Flaim-Support-Token': SUPPORT_TOOL_TOKEN }),
      env,
    );

    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe(`POST ${VERIFY_LEAGUE_MEMBERSHIP_PATH} (implemented)`, () => {
  it('runs the membership verifier and returns its redacted report verbatim', async () => {
    const res = await app.fetch(makeRequest(VERIFY_LEAGUE_MEMBERSHIP_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(VERIFY_LEAGUE_MEMBERSHIP_OK_REPORT);
    expect(runYahooSupportVerifyLeagueMembership).toHaveBeenCalledWith(
      expect.objectContaining({ SUPABASE_URL: baseEnv.SUPABASE_URL }),
      { userId: TARGET_USER_ID, leagueKey: TARGET_LEAGUE_KEY },
    );
    expect(runYahooSupportProbeLeague).not.toHaveBeenCalled();
    expect(runYahooSupportRefresh).not.toHaveBeenCalled();
  });

  it('maps a failed verification to 500 without inventing an error body', async () => {
    const failed = { outcome: 'failed', userMasked: 'user_3Ie...', error: 'membership_verification_failed' } as const;
    vi.mocked(runYahooSupportVerifyLeagueMembership).mockResolvedValue(failed);

    const res = await app.fetch(makeRequest(VERIFY_LEAGUE_MEMBERSHIP_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual(failed);
  });

  it.each([
    ['a bare numeric id', JSON.stringify({ userId: TARGET_USER_ID, leagueKey: '1234567' })],
    ['a nonnumeric game key', JSON.stringify({ userId: TARGET_USER_ID, leagueKey: 'nfl.l.1234567' })],
    ['a path traversal', JSON.stringify({ userId: TARGET_USER_ID, leagueKey: '../470.l.1234567' })],
    ['a suffix', JSON.stringify({ userId: TARGET_USER_ID, leagueKey: '470.l.1234567.t.1' })],
    ['a wrong field name', JSON.stringify({ userId: TARGET_USER_ID, leagueId: TARGET_LEAGUE_KEY })],
  ])('rejects %s without running the verifier', async (_label, body) => {
    const res = await app.fetch(makeRequest(VERIFY_LEAGUE_MEMBERSHIP_PATH, bothTokens(), body), baseEnv);

    expect(res.status).toBe(400);
    expect(runYahooSupportVerifyLeagueMembership).not.toHaveBeenCalled();
  });

  it('rate-limits independently under the verifier action key', async () => {
    const limitedEnv = {
      ...baseEnv,
      CREDENTIALS_RATE_LIMITER: {
        limit: vi.fn(async ({ key }: { key: string }) => ({ success: key !== 'support:verify-league-membership' })),
      },
    };

    const res = await app.fetch(makeRequest(VERIFY_LEAGUE_MEMBERSHIP_PATH, bothTokens()), limitedEnv);

    expect(res.status).toBe(429);
    expect(runYahooSupportVerifyLeagueMembership).not.toHaveBeenCalled();
  });
});

describe(`POST ${LOCATE_LEAGUE_BY_TEAM_NAME_PATH} (implemented)`, () => {
  it('runs the bounded locator and returns only the closed report', async () => {
    const res = await app.fetch(makeRequest(LOCATE_LEAGUE_BY_TEAM_NAME_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(LOCATE_LEAGUE_BY_TEAM_NAME_OK_REPORT);
    expect(runYahooSupportLocateLeagueByTeamName).toHaveBeenCalledWith(
      expect.objectContaining({ SUPABASE_URL: baseEnv.SUPABASE_URL }),
      { userId: TARGET_USER_ID, gameKey: TARGET_GAME_KEY, teamNameSha256: TARGET_TEAM_NAME_SHA256 },
    );
  });

  it.each([
    ['missing game key', JSON.stringify({ userId: TARGET_USER_ID, teamNameSha256: TARGET_TEAM_NAME_SHA256 }), 'invalid_game_key'],
    ['non-numeric game key', JSON.stringify({ userId: TARGET_USER_ID, gameKey: 'nfl', teamNameSha256: TARGET_TEAM_NAME_SHA256 }), 'invalid_game_key'],
    ['uppercase digest', JSON.stringify({ userId: TARGET_USER_ID, gameKey: TARGET_GAME_KEY, teamNameSha256: TARGET_TEAM_NAME_SHA256.toUpperCase() }), 'invalid_team_name_sha256'],
    ['unknown field', JSON.stringify({ userId: TARGET_USER_ID, gameKey: TARGET_GAME_KEY, teamNameSha256: TARGET_TEAM_NAME_SHA256, leagueKey: TARGET_LEAGUE_KEY }), 'invalid_request'],
  ])('rejects %s without running the locator', async (_label, body, error) => {
    const res = await app.fetch(makeRequest(LOCATE_LEAGUE_BY_TEAM_NAME_PATH, bothTokens(), body), baseEnv);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error });
    expect(runYahooSupportLocateLeagueByTeamName).not.toHaveBeenCalled();
  });

  it('rate-limits under its own action key before parsing or locating', async () => {
    const limitedEnv = {
      ...baseEnv,
      CREDENTIALS_RATE_LIMITER: {
        limit: vi.fn(async ({ key }: { key: string }) => ({ success: key !== 'support:locate-league' })),
      },
    };

    const res = await app.fetch(makeRequest(LOCATE_LEAGUE_BY_TEAM_NAME_PATH, bothTokens()), limitedEnv);

    expect(res.status).toBe(429);
    expect(runYahooSupportLocateLeagueByTeamName).not.toHaveBeenCalled();
    expect(parseYahooSupportTeamNameLeagueLocationRequest).not.toHaveBeenCalled();
  });
});

describe(`POST ${CAPTURE_GAME_RAW_PATH} (implemented)`, () => {
  it('returns exact capture bytes and the fixed binary success headers', async () => {
    const res = await app.fetch(makeRequest(CAPTURE_GAME_RAW_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Flaim-Support-Capture')).toBe('yahoo-game-raw-v1');
    expect(res.headers.get('X-Flaim-Upstream-Status')).toBe('503');
    expect(res.headers.get('X-Flaim-Capture-Bytes')).toBe('17');
    expect(res.headers.get('X-Flaim-Capture-SHA256')).toBe(CAPTURE_GAME_RAW_OK_REPORT.capture.sha256);
    expect(res.headers.get('X-Flaim-Correlation-Id')).toBe(CAPTURE_GAME_RAW_OK_REPORT.correlationId);
    await expect(res.text()).resolves.toBe('{"sentinel":true}');
    expect(runYahooSupportGameRawCapture).toHaveBeenCalledWith(
      expect.objectContaining({ SUPABASE_URL: baseEnv.SUPABASE_URL }),
      { userId: TARGET_USER_ID, target: 'game', gameKey: TARGET_GAME_KEY, collection: 'leagues' },
    );
  });

  it('passes the teams collection through the closed request contract', async () => {
    const body = JSON.stringify({ userId: TARGET_USER_ID, gameKey: TARGET_GAME_KEY, collection: 'teams' });
    const res = await app.fetch(makeRequest(CAPTURE_GAME_RAW_PATH, bothTokens(), body), baseEnv);

    expect(res.status).toBe(200);
    expect(runYahooSupportGameRawCapture).toHaveBeenCalledWith(
      expect.objectContaining({ SUPABASE_URL: baseEnv.SUPABASE_URL }),
      { userId: TARGET_USER_ID, target: 'game', gameKey: TARGET_GAME_KEY, collection: 'teams' },
    );
  });

  it('passes the fixed broad discovery target without game fields', async () => {
    const body = JSON.stringify({ userId: TARGET_USER_ID, target: 'discovery' });
    const res = await app.fetch(makeRequest(CAPTURE_GAME_RAW_PATH, bothTokens(), body), baseEnv);

    expect(res.status).toBe(200);
    expect(runYahooSupportGameRawCapture).toHaveBeenCalledWith(
      expect.objectContaining({ SUPABASE_URL: baseEnv.SUPABASE_URL }),
      { userId: TARGET_USER_ID, target: 'discovery' },
    );
  });

  it('passes one strict direct-league teams target without game fields', async () => {
    const body = JSON.stringify({ userId: TARGET_USER_ID, target: 'league-teams', leagueKey: TARGET_LEAGUE_KEY });
    const res = await app.fetch(makeRequest(CAPTURE_GAME_RAW_PATH, bothTokens(), body), baseEnv);

    expect(res.status).toBe(200);
    expect(runYahooSupportGameRawCapture).toHaveBeenCalledWith(
      expect.objectContaining({ SUPABASE_URL: baseEnv.SUPABASE_URL }),
      { userId: TARGET_USER_ID, target: 'league-teams', leagueKey: TARGET_LEAGUE_KEY },
    );
  });

  it.each([
    ['missing game key', JSON.stringify({ userId: TARGET_USER_ID }), 'invalid_game_key'],
    ['non-numeric game key', JSON.stringify({ userId: TARGET_USER_ID, gameKey: 'nfl' }), 'invalid_game_key'],
    ['invalid collection', JSON.stringify({ userId: TARGET_USER_ID, gameKey: TARGET_GAME_KEY, collection: 'rosters' }), 'invalid_collection'],
    ['unknown selector', JSON.stringify({ userId: TARGET_USER_ID, gameKey: TARGET_GAME_KEY, path: '/users' }), 'invalid_request'],
    ['unknown target', JSON.stringify({ userId: TARGET_USER_ID, target: 'url', gameKey: TARGET_GAME_KEY }), 'invalid_capture_target'],
    ['discovery with a game key', JSON.stringify({ userId: TARGET_USER_ID, target: 'discovery', gameKey: TARGET_GAME_KEY }), 'invalid_request'],
    ['discovery with a collection', JSON.stringify({ userId: TARGET_USER_ID, target: 'discovery', collection: 'leagues' }), 'invalid_request'],
    ['league teams missing a full key', JSON.stringify({ userId: TARGET_USER_ID, target: 'league-teams' }), 'invalid_league_key'],
    ['league teams with a malformed key', JSON.stringify({ userId: TARGET_USER_ID, target: 'league-teams', leagueKey: '../470.l.1234567' }), 'invalid_league_key'],
    ['league teams with game fields', JSON.stringify({ userId: TARGET_USER_ID, target: 'league-teams', leagueKey: TARGET_LEAGUE_KEY, gameKey: TARGET_GAME_KEY }), 'invalid_request'],
    ['game with a league key', JSON.stringify({ userId: TARGET_USER_ID, target: 'game', gameKey: TARGET_GAME_KEY, leagueKey: TARGET_LEAGUE_KEY }), 'invalid_request'],
  ])('rejects %s before capture', async (_label, body, error) => {
    const res = await app.fetch(makeRequest(CAPTURE_GAME_RAW_PATH, bothTokens(), body), baseEnv);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error });
    expect(runYahooSupportGameRawCapture).not.toHaveBeenCalled();
  });

  it('returns only a closed JSON error when capture fails', async () => {
    vi.mocked(runYahooSupportGameRawCapture).mockResolvedValue({
      outcome: 'capture_token_detected',
      correlationId: CAPTURE_GAME_RAW_OK_REPORT.correlationId,
      error: 'capture_token_detected',
      httpStatus: 502,
    });

    const res = await app.fetch(makeRequest(CAPTURE_GAME_RAW_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: 'capture_token_detected' });
    expect(res.headers.get('X-Flaim-Support-Capture')).toBeNull();
  });

  it('rate-limits under its own action before validation or capture', async () => {
    const limitedEnv = {
      ...baseEnv,
      CREDENTIALS_RATE_LIMITER: {
        limit: vi.fn(async ({ key }: { key: string }) => ({ success: key !== 'support:capture-game-raw' })),
      },
    };

    const res = await app.fetch(makeRequest(CAPTURE_GAME_RAW_PATH, bothTokens()), limitedEnv);

    expect(res.status).toBe(429);
    expect(parseYahooSupportGameRawCaptureRequest).not.toHaveBeenCalled();
    expect(runYahooSupportGameRawCapture).not.toHaveBeenCalled();
  });
});

describe(`POST ${RECOVER_LEAGUE_PATH} (implemented)`, () => {
  it('runs the one-league recovery and returns only its closed report', async () => {
    const res = await app.fetch(makeRequest(RECOVER_LEAGUE_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(RECOVER_LEAGUE_OK_REPORT);
    expect(runYahooSupportRecoverLeague).toHaveBeenCalledWith(
      expect.objectContaining({ SUPABASE_URL: baseEnv.SUPABASE_URL }),
      { userId: TARGET_USER_ID, leagueKey: TARGET_LEAGUE_KEY },
    );
    expect(runYahooSupportRefresh).not.toHaveBeenCalled();
  });

  it('maps a fail-closed recovery result to 500 without inventing detail', async () => {
    const failed = { outcome: 'failed', userMasked: 'user_3Ie...', error: 'league_recovery_failed' } as const;
    vi.mocked(runYahooSupportRecoverLeague).mockResolvedValue(failed);

    const res = await app.fetch(makeRequest(RECOVER_LEAGUE_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual(failed);
  });

  it.each([
    ['a bare numeric id', JSON.stringify({ userId: TARGET_USER_ID, leagueKey: '1234567' })],
    ['a nonnumeric game key', JSON.stringify({ userId: TARGET_USER_ID, leagueKey: 'nfl.l.1234567' })],
    ['a path traversal', JSON.stringify({ userId: TARGET_USER_ID, leagueKey: '../470.l.1234567' })],
    ['a suffix', JSON.stringify({ userId: TARGET_USER_ID, leagueKey: '470.l.1234567.t.1' })],
    ['a wrong field name', JSON.stringify({ userId: TARGET_USER_ID, leagueId: TARGET_LEAGUE_KEY })],
  ])('rejects %s without running the recovery', async (_label, body) => {
    const res = await app.fetch(makeRequest(RECOVER_LEAGUE_PATH, bothTokens(), body), baseEnv);

    expect(res.status).toBe(400);
    expect(runYahooSupportRecoverLeague).not.toHaveBeenCalled();
  });

  it('rate-limits under its own action key before the recovery can write', async () => {
    const limitedEnv = {
      ...baseEnv,
      CREDENTIALS_RATE_LIMITER: {
        limit: vi.fn(async ({ key }: { key: string }) => ({ success: key !== 'support:recover-league' })),
      },
    };

    const res = await app.fetch(makeRequest(RECOVER_LEAGUE_PATH, bothTokens()), limitedEnv);

    expect(res.status).toBe(429);
    expect(runYahooSupportRecoverLeague).not.toHaveBeenCalled();
  });
});

describe(`POST ${REFRESH_PATH} (implemented)`, () => {
  it('runs the real refresh instead of the Session-1 stub', async () => {
    const res = await app.fetch(makeRequest(REFRESH_PATH, bothTokens()), baseEnv);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(REFRESH_OK_REPORT);
    expect(runYahooSupportRefresh).toHaveBeenCalledTimes(1);
    expect(runYahooSupportRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ SUPABASE_URL: baseEnv.SUPABASE_URL }),
      { userId: TARGET_USER_ID },
    );
    expect(runYahooSupportInspect).not.toHaveBeenCalled();
    expect(runYahooSupportDiagnose).not.toHaveBeenCalled();
  });

  it.each(['refresh_result_missing', 'snapshot_failed'] as const)(
    'maps a %s failure to 500 without inventing an error body',
    async (error) => {
      const failed = { outcome: 'failed', userMasked: 'user_3Ie...', error } as const;
      vi.mocked(runYahooSupportRefresh).mockResolvedValue(failed);

      const res = await app.fetch(makeRequest(REFRESH_PATH, bothTokens()), baseEnv);

      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toEqual(failed);
    },
  );

  // The one write-capable support route: a request that fails validation or
  // authentication must never reach the refresh path at all.
  it('does not run the refresh when the body fails validation', async () => {
    const res = await app.fetch(
      makeRequest(REFRESH_PATH, bothTokens(), JSON.stringify({ userId: 'admin' })),
      baseEnv,
    );

    expect(res.status).toBe(400);
    expect(runYahooSupportRefresh).not.toHaveBeenCalled();
  });

  it('does not run the refresh when authentication fails', async () => {
    const res = await app.fetch(
      makeRequest(REFRESH_PATH, { 'X-Flaim-Internal-Token': INTERNAL_SERVICE_TOKEN }),
      baseEnv,
    );

    expect(res.status).toBe(403);
    expect(runYahooSupportRefresh).not.toHaveBeenCalled();
  });

  // Its own key, separate from diagnose's: a burst of diagnose calls must not
  // exhaust the budget refresh needs to actually persist a fix.
  it('rate-limits refresh independently of diagnose', async () => {
    const limitedEnv = {
      ...baseEnv,
      CREDENTIALS_RATE_LIMITER: { limit: vi.fn(async ({ key }: { key: string }) => ({ success: key !== 'support:refresh' })) },
    };

    const res = await app.fetch(makeRequest(REFRESH_PATH, bothTokens()), limitedEnv);

    expect(res.status).toBe(429);
    expect(runYahooSupportRefresh).not.toHaveBeenCalled();
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
