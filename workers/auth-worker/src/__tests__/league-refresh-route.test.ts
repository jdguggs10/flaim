import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEspnStorage = vi.hoisted(() => ({
  getCredentials: vi.fn(),
  getCurrentSeasonLeagues: vi.fn(),
  getLeagues: vi.fn(),
  getSetupStatus: vi.fn(),
  getCredentialMetadata: vi.fn(),
}));

vi.mock('../supabase-storage', () => ({
  EspnSupabaseStorage: {
    fromEnvironment: vi.fn().mockReturnValue(mockEspnStorage),
  },
}));

vi.mock('../v3/league-discovery', () => ({
  discoverAndSaveLeagues: vi.fn(),
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

vi.mock('../yahoo-connect-handlers', () => ({
  handleYahooAuthorize: vi.fn(),
  handleYahooCallback: vi.fn(),
  handleYahooCredentials: vi.fn(),
  handleYahooCredentialHealth: vi.fn(),
  handleYahooDisconnect: vi.fn(),
  handleYahooDiscover: vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: true, count: 0, leagues: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
  handleYahooStatus: vi.fn(),
  resolveYahooArchiveTarget: vi.fn(),
  YahooConnectEnv: {},
}));

vi.mock('../sleeper-connect-handlers', () => ({
  handleSleeperDiscover: vi.fn(),
  handleSleeperStatus: vi.fn(),
  handleSleeperDisconnect: vi.fn(),
  handleSleeperLeagues: vi.fn(),
  handleSleeperLeagueDelete: vi.fn(),
  resolveSleeperArchiveTarget: vi.fn(),
  refreshSleeperLeaguesFromStoredConnection: vi.fn(),
  SleeperConnectEnv: {},
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

import app from '../index-hono';
import { refreshLeaguesForUser } from '../league-refresh';
import { validateOAuthToken } from '../oauth-handlers';
import { refreshSleeperLeaguesFromStoredConnection } from '../sleeper-connect-handlers';
import { handleYahooDiscover } from '../yahoo-connect-handlers';
import { discoverAndSaveLeagues } from '../v3/league-discovery';

const ISSUER = 'https://flaim-test.clerk.accounts.dev';
const KEY_ID = 'league-refresh-route-test-key';
const EVAL_API_KEY = 'flaim_eval_refresh_route_test';
const EVAL_USER_ID = 'user_eval_refresh';
const INTERNAL_SERVICE_TOKEN = 'internal-refresh-secret';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
  CLERK_ISSUER: ISSUER,
  EVAL_API_KEY,
  EVAL_USER_ID,
  INTERNAL_SERVICE_TOKEN,
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

async function signedClerkToken(sub = 'user_refresh_route'): Promise<string> {
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
  vi.mocked(refreshSleeperLeaguesFromStoredConnection).mockResolvedValue({
    status: 'success',
    details: {
      success: true,
      username: 'stored_user',
      leagues_found: 1,
      seasons_discovered: 1,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /leagues/refresh', () => {
  it('requires Clerk authentication for the public route', async () => {
    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['sleeper'] }),
      headers: { 'Content-Type': 'application/json' },
    }), baseEnv);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'unauthorized',
      error_description: 'Clerk authentication required',
    });
    expect(refreshSleeperLeaguesFromStoredConnection).not.toHaveBeenCalled();
  });

  it('rejects unknown platforms before provider refresh runs', async () => {
    const token = await signedClerkToken();
    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['espn', 'bad-platform'] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'unknown_platform',
      error_description: 'Unknown platform(s): bad-platform',
      unknownPlatforms: ['bad-platform'],
    });
    expect(refreshSleeperLeaguesFromStoredConnection).not.toHaveBeenCalled();
  });

  it('rejects oversized platform arrays before provider refresh runs', async () => {
    const token = await signedClerkToken();
    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['espn', 'espn', 'espn', 'espn'] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid_platforms',
      error_description: 'platforms may include at most 3 entries',
    });
    expect(refreshSleeperLeaguesFromStoredConnection).not.toHaveBeenCalled();
  });

  it('rejects empty platform arrays before provider refresh runs', async () => {
    const token = await signedClerkToken();
    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: [] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid_platforms',
      error_description: 'platforms must include at least one platform',
    });
    expect(refreshSleeperLeaguesFromStoredConnection).not.toHaveBeenCalled();
  });

  it('allows a Clerk-authenticated public caller and aggregates Sleeper refresh', async () => {
    const token = await signedClerkToken('user_public_refresh');
    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['sleeper'] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      requestedPlatforms: ['sleeper'],
      results: {
        sleeper: {
          platform: 'sleeper',
          status: 'success',
          httpStatus: 200,
          details: {
            success: true,
            username: 'stored_user',
            leagues_found: 1,
            seasons_discovered: 1,
          },
        },
      },
    });
    expect(refreshSleeperLeaguesFromStoredConnection).toHaveBeenCalledWith(baseEnv, 'user_public_refresh');
  });

  it('rate-limits public refresh per user before provider refresh runs', async () => {
    const token = await signedClerkToken('user_rate_limited');
    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['sleeper'] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), {
      ...baseEnv,
      CREDENTIALS_RATE_LIMITER: {
        limit: vi.fn(async ({ key }: { key: string }) => {
          expect(key).toBe('refresh:user_rate_limited');
          return { success: false };
        }),
      },
    });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(await res.json()).toEqual({
      error: 'rate_limit_exceeded',
      error_description: 'Too many refresh requests. Please try again later.',
    });
    expect(refreshSleeperLeaguesFromStoredConnection).not.toHaveBeenCalled();
  });
});

describe('POST /internal/leagues/refresh', () => {
  it('requires the internal service token', async () => {
    const res = await app.fetch(makeRequest('/auth/internal/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['sleeper'] }),
      headers: {
        Authorization: `Bearer ${EVAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'unauthorized',
      error_description: 'Missing or invalid X-Flaim-Internal-Token',
    });
    expect(refreshSleeperLeaguesFromStoredConnection).not.toHaveBeenCalled();
  });

  it('rejects an internal static API key caller without mcp:write scope', async () => {
    const res = await app.fetch(makeRequest('/auth/internal/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['sleeper'] }),
      headers: {
        Authorization: `Bearer ${EVAL_API_KEY}`,
        'X-Flaim-Internal-Token': INTERNAL_SERVICE_TOKEN,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'insufficient_scope',
      error_description: 'mcp:write scope is required to refresh leagues',
    });
    expect(refreshSleeperLeaguesFromStoredConnection).not.toHaveBeenCalled();
  });

  it('allows an internal mcp:write OAuth caller and aggregates Sleeper refresh', async () => {
    vi.mocked(validateOAuthToken).mockResolvedValueOnce({
      userId: 'user_oauth_refresh',
      scope: 'mcp:write',
      clientName: 'ChatGPT',
    });

    const res = await app.fetch(makeRequest('/auth/internal/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['sleeper'] }),
      headers: {
        Authorization: 'Bearer oauth-refresh-token',
        'X-Flaim-Internal-Token': INTERNAL_SERVICE_TOKEN,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      requestedPlatforms: ['sleeper'],
      results: {
        sleeper: {
          platform: 'sleeper',
          status: 'success',
          httpStatus: 200,
          details: {
            success: true,
            username: 'stored_user',
            leagues_found: 1,
            seasons_discovered: 1,
          },
        },
      },
    });
    expect(refreshSleeperLeaguesFromStoredConnection).toHaveBeenCalledWith(baseEnv, 'user_oauth_refresh');
  });

  it('rate-limits internal refresh per resolved user before provider refresh runs', async () => {
    vi.mocked(validateOAuthToken).mockResolvedValueOnce({
      userId: 'user_oauth_rate_limited',
      scope: 'mcp:write',
      clientName: 'ChatGPT',
    });
    const limit = vi.fn(async ({ key }: { key: string }) => {
      expect(key).toBe('refresh:user_oauth_rate_limited');
      return { success: false };
    });

    const res = await app.fetch(makeRequest('/auth/internal/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['sleeper'] }),
      headers: {
        Authorization: 'Bearer oauth-refresh-token',
        'X-Flaim-Internal-Token': INTERNAL_SERVICE_TOKEN,
        'Content-Type': 'application/json',
      },
    }), {
      ...baseEnv,
      CREDENTIALS_RATE_LIMITER: { limit },
    });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(await res.json()).toEqual({
      error: 'rate_limit_exceeded',
      error_description: 'Too many refresh requests. Please try again later.',
    });
    expect(limit).toHaveBeenCalledOnce();
    expect(refreshSleeperLeaguesFromStoredConnection).not.toHaveBeenCalled();
  });
});

describe('refreshLeaguesForUser', () => {
  it('starts requested platform refreshes concurrently', async () => {
    mockEspnStorage.getCredentials.mockResolvedValue({ swid: '{SWID}', s2: 'espn_s2' });
    vi.mocked(discoverAndSaveLeagues).mockResolvedValue({
      discovered: [],
      currentSeason: { found: 0, added: 0, alreadySaved: 0, refreshed: 0 },
      pastSeasons: { found: 0, added: 0, alreadySaved: 0, refreshed: 0 },
    });

    const started = new Set<string>();
    let releaseAll: (() => void) | null = null;
    const allStarted = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });

    function markStarted(platform: string) {
      started.add(platform);
      if (started.size === 3) releaseAll?.();
    }

    vi.mocked(discoverAndSaveLeagues).mockImplementation(async () => {
      markStarted('espn');
      await allStarted;
      return {
        discovered: [],
        currentSeason: { found: 0, added: 0, alreadySaved: 0, refreshed: 0 },
        pastSeasons: { found: 0, added: 0, alreadySaved: 0, refreshed: 0 },
      };
    });
    vi.mocked(handleYahooDiscover).mockImplementation(async () => {
      markStarted('yahoo');
      await allStarted;
      return new Response(JSON.stringify({ success: true, count: 0, leagues: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.mocked(refreshSleeperLeaguesFromStoredConnection).mockImplementation(async () => {
      markStarted('sleeper');
      await allStarted;
      return {
        status: 'success',
        details: { success: true, username: 'stored_user', leagues_found: 0, seasons_discovered: 0 },
      };
    });

    const result = await Promise.race([
      refreshLeaguesForUser(baseEnv, 'user_concurrent', ['espn', 'yahoo', 'sleeper'], {}),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('refresh did not start all platforms concurrently')), 100);
      }),
    ]);

    expect(result.success).toBe(true);
    expect(started).toEqual(new Set(['espn', 'yahoo', 'sleeper']));
  });
});
