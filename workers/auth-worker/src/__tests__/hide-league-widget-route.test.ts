import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// FLA-277: route-level coverage for POST /user/preferences/hide-league-widget.
// Modeled on espn-credentials-route.test.ts's real-JWT + mocked-storage
// pattern, since no existing route-level test covers the sibling
// /user/preferences/default-sport endpoint to copy directly.

const mockStorage = vi.hoisted(() => ({
  setHideLeagueWidget: vi.fn(),
  getUserPreferences: vi.fn(),
}));

vi.mock('../supabase-storage', () => ({
  EspnSupabaseStorage: {
    fromEnvironment: vi.fn().mockReturnValue(mockStorage),
  },
}));

vi.mock('../oauth-storage', () => ({
  OAuthStorage: {
    fromEnvironment: vi.fn().mockReturnValue({}),
  },
}));

vi.mock('../yahoo-storage', () => ({
  YahooStorage: {
    fromEnvironment: vi.fn().mockReturnValue({}),
  },
}));

vi.mock('../oauth-handlers', () => ({
  handleMetadataDiscovery: vi.fn(),
  handleClientRegistration: vi.fn(),
  handleAuthorize: vi.fn(),
  handleCreateCode: vi.fn(),
  handleToken: vi.fn(),
  handleRevoke: vi.fn(),
  handleCheckStatus: vi.fn(),
  handleRevokeAll: vi.fn(),
  handleRevokeSingle: vi.fn(),
  validateOAuthToken: vi.fn().mockResolvedValue(null),
  OAuthEnv: {},
}));

vi.mock('../yahoo-connect-handlers', () => ({
  handleYahooAuthorize: vi.fn(),
  handleYahooCallback: vi.fn(),
  handleYahooCredentials: vi.fn(),
  handleYahooCredentialHealth: vi.fn(),
  handleYahooDisconnect: vi.fn(),
  handleYahooDiscover: vi.fn(),
  handleYahooStatus: vi.fn(),
  resolveYahooArchiveTarget: vi.fn(),
  YahooConnectEnv: {},
}));

import app from '../index-hono';

const ISSUER = 'https://flaim-test.clerk.accounts.dev';
const KEY_ID = 'hide-league-widget-route-test-key';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
  CLERK_ISSUER: ISSUER,
  TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CREDENTIALS_RATE_LIMITER: { limit: async () => ({ success: true }) },
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

async function signedClerkToken(sub = 'user_hide_widget_route_test'): Promise<string> {
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

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://api.flaim.app${path}`, init);
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
  publicJwk = {
    ...exported,
    kid: KEY_ID,
    alg: 'RS256',
    use: 'sig',
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => {
    return new Response(JSON.stringify({ keys: [publicJwk] }), {
      headers: { 'content-type': 'application/json' },
    });
  }));
  mockStorage.setHideLeagueWidget.mockResolvedValue({ success: true });
  mockStorage.getUserPreferences.mockResolvedValue({
    clerkUserId: 'user_hide_widget_route_test',
    defaultSport: null,
    defaultFootball: null,
    defaultBaseball: null,
    defaultBasketball: null,
    defaultHockey: null,
    hideLeagueWidget: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /user/preferences/hide-league-widget', () => {
  it('requires Clerk authentication', async () => {
    const res = await app.fetch(makeRequest('/auth/user/preferences/hide-league-widget', {
      method: 'POST',
      body: JSON.stringify({ hideLeagueWidget: true }),
      headers: { 'Content-Type': 'application/json' },
    }), baseEnv);

    expect(res.status).toBe(401);
    expect(mockStorage.setHideLeagueWidget).not.toHaveBeenCalled();
  });

  it('persists the preference and returns refreshed preferences on success', async () => {
    const token = await signedClerkToken();
    const res = await app.fetch(makeRequest('/auth/user/preferences/hide-league-widget', {
      method: 'POST',
      body: JSON.stringify({ hideLeagueWidget: true }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(200);
    expect(mockStorage.setHideLeagueWidget).toHaveBeenCalledWith('user_hide_widget_route_test', true);
    const body = await res.json() as { hideLeagueWidget: boolean };
    expect(body.hideLeagueWidget).toBe(true);
  });

  it('returns 500 and does not report stale success when the storage write fails', async () => {
    mockStorage.setHideLeagueWidget.mockResolvedValueOnce({ success: false, error: 'db unavailable' });
    const token = await signedClerkToken();
    const res = await app.fetch(makeRequest('/auth/user/preferences/hide-league-widget', {
      method: 'POST',
      body: JSON.stringify({ hideLeagueWidget: true }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'preference_write_failed',
      error_description: 'db unavailable',
    });
    // The route must not read-back and report success when the write failed.
    expect(mockStorage.getUserPreferences).not.toHaveBeenCalled();
  });

  it('rejects a null JSON body with a 400 instead of throwing', async () => {
    const token = await signedClerkToken();
    const res = await app.fetch(makeRequest('/auth/user/preferences/hide-league-widget', {
      method: 'POST',
      body: 'null',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid_hide_league_widget',
      error_description: 'hideLeagueWidget must be a boolean',
    });
    expect(mockStorage.setHideLeagueWidget).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean hideLeagueWidget value with a 400', async () => {
    const token = await signedClerkToken();
    const res = await app.fetch(makeRequest('/auth/user/preferences/hide-league-widget', {
      method: 'POST',
      body: JSON.stringify({ hideLeagueWidget: 'true' }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid_hide_league_widget',
      error_description: 'hideLeagueWidget must be a boolean',
    });
    expect(mockStorage.setHideLeagueWidget).not.toHaveBeenCalled();
  });
});
