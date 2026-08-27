import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEspnStorage = vi.hoisted(() => ({
  getCredentials: vi.fn(),
  getCurrentSeasonLeagues: vi.fn(),
  getLeagues: vi.fn(),
  getSetupStatus: vi.fn(),
  getCredentialMetadata: vi.fn(),
}));

const mockHistoryStorage = vi.hoisted(() => ({
  activeForUser: vi.fn(),
  latestForUser: vi.fn(),
  credentials: vi.fn(),
  createOrCoalesce: vi.fn(),
  setCurrentLeagues: vi.fn(),
  terminal: vi.fn(),
}));

const mockStartQueuedEspnHistoryJob = vi.hoisted(() => vi.fn());

vi.mock('../supabase-storage', () => ({
  EspnSupabaseStorage: {
    fromEnvironment: vi.fn().mockReturnValue(mockEspnStorage),
  },
}));

vi.mock('../v3/league-discovery', () => ({
  discoverAndSaveCurrentLeagues: vi.fn(),
  discoverAndSaveLeagues: vi.fn(),
}));

vi.mock('../espn-history', () => ({
  EspnHistoryRefreshWorkflow: class {},
  EspnHistoryJobStorage: {
    fromEnvironment: vi.fn().mockReturnValue(mockHistoryStorage),
  },
  durableHistoryEnabledFor: (
    env: { ESPN_DURABLE_HISTORY_ENABLED?: string; ESPN_DURABLE_HISTORY_USERS?: string },
    userId: string,
  ) => env.ESPN_DURABLE_HISTORY_ENABLED === 'true'
    && (env.ESPN_DURABLE_HISTORY_USERS ?? '').split(',').map((value) => value.trim()).includes(userId),
  publicHistoryStatus: (job: { id: string; status: string } | null) => job ? ({
    jobId: job.id,
    state: job.status,
    counts: { planned: 0, completed: 0, skipped: 0, failed: 0 },
    retryable: false,
  }) : null,
  startQueuedEspnHistoryJob: mockStartQueuedEspnHistoryJob,
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

const mockSyncState = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  transferLease: vi.fn(),
  settle: vi.fn(),
}));

vi.mock('../sync-state', () => ({
  SyncStateStorage: {
    fromEnvironment: vi.fn().mockReturnValue(mockSyncState),
  },
  logSyncEnvelope: vi.fn(),
  NORMAL_REFRESH_COOLDOWN_SECONDS: 75,
  UPSTREAM_BACKOFF_COOLDOWN_SECONDS: 300,
  SYNC_COOLDOWN_OWNER_PREFIX: 'cooldown:',
  SYNC_LEASE_TTL_MS: 120_000,
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
import { discoverAndSaveCurrentLeagues, discoverAndSaveLeagues } from '../v3/league-discovery';

const ISSUER = 'https://flaim-test.clerk.accounts.dev';
const KEY_ID = 'league-refresh-route-test-key';
const EVAL_API_KEY = 'flaim_eval_refresh_route_test';
const EVAL_USER_ID = 'user_eval_refresh';
const DEMO_API_KEY = 'flaim_demo_refresh_route_test';
const DEMO_USER_ID = 'user_demo_refresh';
const INTERNAL_SERVICE_TOKEN = 'internal-refresh-secret';

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
  mockSyncState.acquireLease.mockResolvedValue({ acquired: true });
  mockSyncState.transferLease.mockResolvedValue(true);
  mockSyncState.settle.mockResolvedValue(undefined);
  mockHistoryStorage.activeForUser.mockResolvedValue(null);
  mockHistoryStorage.latestForUser.mockResolvedValue(null);
  mockHistoryStorage.credentials.mockResolvedValue({
    swid: '{swid}',
    s2: 's2token',
    updatedAt: '2026-08-26T20:00:00.000Z',
  });
  mockHistoryStorage.setCurrentLeagues.mockResolvedValue(true);
  mockHistoryStorage.terminal.mockResolvedValue(undefined);
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

  it('returns current ESPN leagues immediately and transfers web history to a durable job', async () => {
    const userId = 'user_durable_web';
    const token = await signedClerkToken(userId);
    const currentResult = {
      discovered: [{
        sport: 'baseball',
        leagueId: '123',
        leagueName: 'Current League',
        teamId: '8',
        teamName: 'Current Team',
        seasonYear: 2026,
      }],
      currentSeason: { found: 1, added: 0, alreadySaved: 1, refreshed: 1 },
      savedLeagues: [{
        leagueId: '123',
        gameId: 'flb',
        leagueName: 'Current League',
        teamId: 8,
        teamName: 'Current Team',
        seasonId: 2026,
      }],
    };
    const job = { id: 'job-1', status: 'queued', workflow_instance_id: null };
    vi.mocked(discoverAndSaveCurrentLeagues).mockResolvedValue(currentResult as never);
    mockHistoryStorage.createOrCoalesce.mockResolvedValue({ job, created: true });
    mockStartQueuedEspnHistoryJob.mockResolvedValue({
      job: { ...job, workflow_instance_id: 'espn-history-job-1' },
      created: true,
    });

    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['espn'] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), {
      ...baseEnv,
      ESPN_DURABLE_HISTORY_ENABLED: 'true',
      ESPN_DURABLE_HISTORY_USERS: userId,
      ESPN_HISTORY_REFRESH: { create: vi.fn() },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results.espn.details.history).toMatchObject({ jobId: 'job-1', state: 'queued' });
    expect(discoverAndSaveCurrentLeagues).toHaveBeenCalledOnce();
    expect(discoverAndSaveLeagues).not.toHaveBeenCalled();
    expect(mockHistoryStorage.setCurrentLeagues).toHaveBeenCalledWith('job-1', currentResult.savedLeagues);
    expect(mockSyncState.transferLease).toHaveBeenCalledWith(
      userId,
      'espn',
      expect.any(String),
      'history:job-1',
    );
    expect(mockSyncState.settle).not.toHaveBeenCalled();
  });

  it('does not queue history when any discovered current ESPN row failed to save', async () => {
    const userId = 'user_partial_current_write';
    const token = await signedClerkToken(userId);
    vi.mocked(discoverAndSaveCurrentLeagues).mockResolvedValue({
      discovered: [],
      currentSeason: { found: 2, added: 0, alreadySaved: 0, refreshed: 0 },
      savedLeagues: [{ leagueId: '123' }],
    } as never);

    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['espn'] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), {
      ...baseEnv,
      ESPN_DURABLE_HISTORY_ENABLED: 'true',
      ESPN_DURABLE_HISTORY_USERS: userId,
      ESPN_HISTORY_REFRESH: { create: vi.fn() },
    });

    const body = await res.json() as any;
    expect(body.results.espn).toMatchObject({ status: 'error', httpStatus: 500 });
    expect(mockHistoryStorage.createOrCoalesce).not.toHaveBeenCalled();
    expect(mockSyncState.transferLease).not.toHaveBeenCalled();
    expect(mockSyncState.settle).toHaveBeenCalledOnce();
  });

  it('returns an existing caller-owned history job without taking another ESPN lease', async () => {
    const userId = 'user_existing_history';
    const token = await signedClerkToken(userId);
    mockHistoryStorage.activeForUser.mockResolvedValue({ id: 'job-active', status: 'running' });
    mockEspnStorage.getCurrentSeasonLeagues.mockResolvedValue([]);

    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['espn'] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), {
      ...baseEnv,
      ESPN_DURABLE_HISTORY_ENABLED: 'true',
      ESPN_DURABLE_HISTORY_USERS: userId,
      ESPN_HISTORY_REFRESH: { create: vi.fn() },
    });

    const body = await res.json() as any;
    expect(body.results.espn.details.history).toMatchObject({ jobId: 'job-active', state: 'running' });
    expect(mockSyncState.acquireLease).not.toHaveBeenCalled();
    expect(discoverAndSaveCurrentLeagues).not.toHaveBeenCalled();
  });

  it('terminalizes the job and releases the request lease when history lease transfer fails', async () => {
    const userId = 'user_transfer_failure';
    const token = await signedClerkToken(userId);
    const currentResult = {
      discovered: [{ sport: 'football', leagueId: '1', seasonYear: 2026 }],
      currentSeason: { found: 1, added: 1, alreadySaved: 0, refreshed: 0 },
      savedLeagues: [{
        leagueId: '1', gameId: 'ffl', leagueName: 'League', teamId: 1,
        teamName: 'Team', seasonId: 2026,
      }],
    };
    const job = { id: 'job-transfer', status: 'queued', workflow_instance_id: null };
    vi.mocked(discoverAndSaveCurrentLeagues).mockResolvedValue(currentResult as never);
    mockHistoryStorage.createOrCoalesce.mockResolvedValue({ job, created: true });
    mockSyncState.transferLease.mockResolvedValue(false);

    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['espn'] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), {
      ...baseEnv,
      ESPN_DURABLE_HISTORY_ENABLED: 'true',
      ESPN_DURABLE_HISTORY_USERS: userId,
      ESPN_HISTORY_REFRESH: { create: vi.fn() },
    });

    const body = await res.json() as any;
    expect(body.results.espn.status).toBe('error');
    expect(mockHistoryStorage.terminal).toHaveBeenCalledWith(
      'job-transfer',
      'failed',
      'history_lease_transfer_failed',
      expect.any(String),
    );
    expect(mockStartQueuedEspnHistoryJob).not.toHaveBeenCalled();
    expect(mockSyncState.settle).toHaveBeenCalledOnce();
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

  it('rejects the read-only demo static API key without mcp:write scope', async () => {
    const res = await app.fetch(makeRequest('/auth/internal/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['sleeper'] }),
      headers: {
        Authorization: `Bearer ${DEMO_API_KEY}`,
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

  it('allows the eval static API key through the mcp:write scope gate', async () => {
    const res = await app.fetch(makeRequest('/auth/internal/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['sleeper'] }),
      headers: {
        Authorization: `Bearer ${EVAL_API_KEY}`,
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
    expect(refreshSleeperLeaguesFromStoredConnection).toHaveBeenCalledWith(baseEnv, EVAL_USER_ID);
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
  it('keeps MCP ESPN refresh synchronous even when the durable web rollout is enabled', async () => {
    const userId = 'user_mcp_sync';
    mockEspnStorage.getCredentials.mockResolvedValue({ swid: '{SWID}', s2: 'espn_s2' });
    vi.mocked(discoverAndSaveLeagues).mockResolvedValue({
      discovered: [],
      currentSeason: { found: 0, added: 0, alreadySaved: 0, refreshed: 0 },
      pastSeasons: { found: 0, added: 0, alreadySaved: 0, refreshed: 0 },
    });

    await refreshLeaguesForUser({
      ...baseEnv,
      ESPN_DURABLE_HISTORY_ENABLED: 'true',
      ESPN_DURABLE_HISTORY_USERS: userId,
      ESPN_HISTORY_REFRESH: { create: vi.fn() },
    }, userId, ['espn'], {}, undefined, 'mcp');

    expect(discoverAndSaveLeagues).toHaveBeenCalledOnce();
    expect(discoverAndSaveCurrentLeagues).not.toHaveBeenCalled();
    expect(mockHistoryStorage.createOrCoalesce).not.toHaveBeenCalled();
  });

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

describe('refresh cooldown envelope (FLA-121)', () => {
  it('returns a whole-response 429 with Retry-After when every provider is cooling down', async () => {
    mockSyncState.acquireLease
      .mockResolvedValueOnce({ acquired: false, state: 'cooldown', retryAfterSeconds: 42 })
      .mockResolvedValueOnce({ acquired: false, state: 'in_progress', retryAfterSeconds: 90 });

    const token = await signedClerkToken('user_cooldown_all');
    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['espn', 'sleeper'] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('90');
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('refresh_cooldown');
    expect(body.retry_after).toBe(90);
    expect(body.success).toBe(false);
    expect(refreshSleeperLeaguesFromStoredConnection).not.toHaveBeenCalled();
    expect(mockSyncState.settle).not.toHaveBeenCalled();
  });

  it('returns 200 with a per-provider cooldown result when only some providers are blocked', async () => {
    mockSyncState.acquireLease.mockImplementation(async (_userId: string, provider: string) => (
      provider === 'espn'
        ? { acquired: false, state: 'cooldown', retryAfterSeconds: 30 }
        : { acquired: true }
    ));

    const token = await signedClerkToken('user_cooldown_partial');
    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['espn', 'sleeper'] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      results: Record<string, { status: string; httpStatus: number; error?: string; retryAfter?: string }>;
    };
    expect(body.success).toBe(true);
    expect(body.results.espn).toMatchObject({
      status: 'error',
      httpStatus: 429,
      error: 'refresh_cooldown',
      retryAfter: '30',
    });
    expect(body.results.sleeper.status).toBe('success');
    // Only the provider that actually ran settles into a cooldown, and the
    // Sleeper league count (details.leagues_found) reaches telemetry.
    expect(mockSyncState.settle).toHaveBeenCalledOnce();
    expect(mockSyncState.settle).toHaveBeenCalledWith(
      'user_cooldown_partial',
      'sleeper',
      expect.any(String),
      expect.objectContaining({ status: 'success', syncSource: 'web', leagueCount: 1 }),
    );
  });

  it('settles skipped providers as skipped with a minimal cooldown', async () => {
    mockEspnStorage.getCredentials.mockResolvedValue(null); // no ESPN credentials → skipped

    const token = await signedClerkToken('user_skipped_espn');
    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['espn'] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(200);
    expect(mockSyncState.settle).toHaveBeenCalledWith(
      'user_skipped_espn',
      'espn',
      expect.any(String),
      expect.objectContaining({ status: 'skipped', cooldownSeconds: 1 }),
    );
  });

  it('settles an error refresh with the error code for last-run telemetry', async () => {
    vi.mocked(refreshSleeperLeaguesFromStoredConnection).mockRejectedValue(new Error('sleeper exploded'));

    const token = await signedClerkToken('user_cooldown_error');
    const res = await app.fetch(makeRequest('/auth/leagues/refresh', {
      method: 'POST',
      body: JSON.stringify({ platforms: ['sleeper'] }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }), baseEnv);

    expect(res.status).toBe(200);
    expect(mockSyncState.settle).toHaveBeenCalledWith(
      'user_cooldown_error',
      'sleeper',
      expect.any(String),
      expect.objectContaining({
        status: 'error',
        errorCode: 'discovery_failed',
        cooldownSeconds: 75,
      }),
    );
  });

  it('blocks /extension/discover with 429 + Retry-After during cooldown', async () => {
    mockEspnStorage.getCredentials.mockResolvedValue({ swid: '{SWID}', s2: 'espn_s2' });
    mockSyncState.acquireLease.mockResolvedValue({ acquired: false, state: 'cooldown', retryAfterSeconds: 55 });

    const token = await signedClerkToken('user_discover_cooldown');
    const res = await app.fetch(makeRequest('/auth/extension/discover', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }), baseEnv);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('55');
    expect(await res.json()).toEqual({
      error: 'refresh_cooldown',
      error_description: 'ESPN refresh is cooling down. Try again in 55 seconds.',
      retry_after: 55,
    });
    expect(discoverAndSaveLeagues).not.toHaveBeenCalled();
  });

  it('settles /extension/discover success with league count telemetry', async () => {
    mockEspnStorage.getCredentials.mockResolvedValue({ swid: '{SWID}', s2: 'espn_s2' });
    mockEspnStorage.getCurrentSeasonLeagues.mockResolvedValue([
      { sport: 'football', leagueId: '1', leagueName: 'L1', teamId: '2', teamName: 'T', seasonYear: 2026 },
    ]);
    vi.mocked(discoverAndSaveLeagues).mockResolvedValue({
      discovered: [],
      currentSeason: { found: 1, added: 1, alreadySaved: 0, refreshed: 0 },
      pastSeasons: { found: 0, added: 0, alreadySaved: 0, refreshed: 0 },
    });

    const token = await signedClerkToken('user_discover_ok');
    const res = await app.fetch(makeRequest('/auth/extension/discover', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }), baseEnv);

    expect(res.status).toBe(200);
    expect(mockSyncState.settle).toHaveBeenCalledWith(
      'user_discover_ok',
      'espn',
      expect.any(String),
      expect.objectContaining({
        status: 'success',
        syncSource: 'extension',
        leagueCount: 1,
        cooldownSeconds: 75,
      }),
    );
  });
});
