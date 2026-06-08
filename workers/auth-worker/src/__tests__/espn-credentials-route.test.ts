import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockStorage = vi.hoisted(() => ({
  getCredentials: vi.fn(),
  getCredentialMetadata: vi.fn(),
  getSetupStatus: vi.fn(),
  deleteCredentials: vi.fn(),
  setCredentials: vi.fn(),
}));

vi.mock('../supabase-storage', () => {
  return {
    EspnSupabaseStorage: {
      fromEnvironment: vi.fn().mockReturnValue(mockStorage),
    },
  };
});

vi.mock('../oauth-storage', () => {
  return {
    OAuthStorage: {
      fromEnvironment: vi.fn().mockReturnValue({}),
    },
  };
});

vi.mock('../yahoo-storage', () => {
  return {
    YahooStorage: {
      fromEnvironment: vi.fn().mockReturnValue({}),
    },
  };
});

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
  YahooConnectEnv: {},
}));

import app from '../index-hono';

const ISSUER = 'https://flaim-test.clerk.accounts.dev';
const KEY_ID = 'espn-credentials-route-test-key';
const RAW_SWID = '{11111111-2222-3333-4444-555555555555}';
const RAW_S2 = 'raw-espn-s2-secret-value-that-should-not-return-to-browser';

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

async function signedClerkToken(sub = 'user_public_route_test'): Promise<string> {
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

function makeRequest(path: string, token: string): Request {
  return new Request(`https://api.flaim.app${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
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
  mockStorage.getCredentials.mockResolvedValue({ swid: RAW_SWID, s2: RAW_S2 });
  mockStorage.getCredentialMetadata.mockResolvedValue({
    hasCredentials: true,
    email: 'user@example.com',
    lastUpdated: '2026-06-08T16:30:00.000Z',
  });
  mockStorage.getSetupStatus.mockResolvedValue({
    hasCredentials: true,
    hasLeagues: false,
    hasDefaultTeam: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /auth/credentials/espn?forEdit=true', () => {
  it('returns replace-only metadata without raw ESPN credentials', async () => {
    const token = await signedClerkToken();
    const res = await app.fetch(makeRequest('/auth/credentials/espn?forEdit=true', token), baseEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    expect(body).toEqual({
      hasCredentials: true,
      platform: 'espn',
      email: 'user@example.com',
      lastUpdated: '2026-06-08T16:30:00.000Z',
      replaceOnly: true,
      maskedSwid: '{********-****-****-****-************}',
      maskedS2: '************',
    });
    expect(body).not.toHaveProperty('swid');
    expect(body).not.toHaveProperty('s2');
    expect(JSON.stringify(body)).not.toContain(RAW_SWID);
    expect(JSON.stringify(body)).not.toContain(RAW_S2);
    expect(mockStorage.getCredentialMetadata).toHaveBeenCalledWith('user_public_route_test');
    expect(mockStorage.getCredentials).not.toHaveBeenCalled();
  });

  it('returns an empty replace-only state when credentials are absent', async () => {
    mockStorage.getCredentialMetadata.mockResolvedValueOnce({ hasCredentials: false });

    const token = await signedClerkToken();
    const res = await app.fetch(makeRequest('/auth/credentials/espn?forEdit=true', token), baseEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    expect(body).toEqual({
      hasCredentials: false,
      platform: 'espn',
      replaceOnly: true,
    });
    expect(body).not.toHaveProperty('swid');
    expect(body).not.toHaveProperty('s2');
    expect(mockStorage.getCredentials).not.toHaveBeenCalled();
  });
});
