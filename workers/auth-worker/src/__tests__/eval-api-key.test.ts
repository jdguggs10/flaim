import { describe, expect, it, vi, beforeEach } from 'vitest';
import app from '../index-hono';

// Mock Clerk JWKS fetch so JWT verification always fails (no real Clerk in tests)
vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network in test')));

const EVAL_API_KEY = 'flaim_eval_abc123testkey';
const EVAL_USER_ID = 'user_eval_test_12345';
const DEMO_API_KEY = 'flaim_demo_abc123testkey';
const DEMO_USER_ID = 'user_demo_test_54321';
const INTERNAL_SERVICE_TOKEN = 'internal-service-secret';

const mockRateLimiter = { limit: async () => ({ success: true }) };

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
  EVAL_API_KEY,
  EVAL_USER_ID,
  DEMO_API_KEY,
  DEMO_USER_ID,
  INTERNAL_SERVICE_TOKEN,
  TOKEN_RATE_LIMITER: mockRateLimiter,
  CREDENTIALS_RATE_LIMITER: mockRateLimiter,
};

function makeRequest(path: string, options?: RequestInit): Request {
  return new Request(`https://api.flaim.app${path}`, options);
}

function bearerHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function internalHeaders(token: string): HeadersInit {
  return {
    ...bearerHeaders(token),
    'X-Flaim-Internal-Token': INTERNAL_SERVICE_TOKEN,
  };
}

async function appFetch(req: Request, env = baseEnv): Promise<Response> {
  return app.fetch(req, env);
}

// ---------------------------------------------------------------------------
// Mock Supabase calls so routes that query storage don't fail
// ---------------------------------------------------------------------------
vi.mock('../supabase-storage', () => {
  const mockStorage = {
    getCredentials: vi.fn().mockResolvedValue({ swid: 'test-swid', s2: 'test-s2' }),
    getLeagues: vi.fn().mockResolvedValue([]),
    getCurrentSeasonLeagues: vi.fn().mockResolvedValue([]),
    hasCredentials: vi.fn().mockResolvedValue(true),
    getSetupStatus: vi.fn().mockResolvedValue({ hasCredentials: true, hasLeagues: false, hasDefaultTeam: false }),
    getCredentialMetadata: vi.fn().mockResolvedValue(null),
    getUserPreferences: vi.fn().mockResolvedValue({
      defaultSport: null,
      defaultFootball: null,
      defaultBaseball: null,
      defaultBasketball: null,
      defaultHockey: null,
    }),
    clearDefaultLeague: vi.fn().mockResolvedValue({ success: true }),
    clearStaleDefaultForLeague: vi.fn().mockResolvedValue(undefined),
  };
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
  const mockYahooStorage = {
    getYahooLeagues: vi.fn().mockResolvedValue([]),
  };
  return {
    YahooStorage: {
      fromEnvironment: vi.fn().mockReturnValue(mockYahooStorage),
    },
  };
});

vi.mock('../yahoo-connect-handlers', () => ({
  handleYahooAuthorize: vi.fn(),
  handleYahooCallback: vi.fn(),
  handleYahooCredentials: vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ access_token: 'test' }), { status: 200 })
  ),
  handleYahooDisconnect: vi.fn(),
  handleYahooDiscover: vi.fn(),
  handleYahooStatus: vi.fn(),
  YahooConnectEnv: {},
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
  // validateOAuthToken returns null so OAuth fallback always fails
  validateOAuthToken: vi.fn().mockResolvedValue(null),
  OAuthEnv: {},
}));

describe('eval API key auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Positive — MCP-read path works
  // =========================================================================

  it('GET /auth/internal/introspect with valid API key returns valid', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/introspect', {
        headers: {
          ...internalHeaders(EVAL_API_KEY),
          'X-Flaim-Expected-Resource': 'https://api.flaim.app/mcp',
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; userId: string; scope: string; authType: string };
    expect(body.valid).toBe(true);
    expect(body.userId).toBe(EVAL_USER_ID);
    expect(body.scope).toBe('mcp:read');
    expect(body.authType).toBe('eval-api-key');
  });

  it('GET /auth/internal/introspect with valid demo API key returns demo user', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/introspect', {
        headers: {
          ...internalHeaders(DEMO_API_KEY),
          'X-Flaim-Expected-Resource': 'https://api.flaim.app/mcp',
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; userId: string; scope: string; authType: string };
    expect(body.valid).toBe(true);
    expect(body.userId).toBe(DEMO_USER_ID);
    expect(body.scope).toBe('mcp:read');
    expect(body.authType).toBe('demo-api-key');
  });

  it('GET /auth/internal/credentials/espn/raw with valid API key returns credentials', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/credentials/espn/raw', {
        headers: internalHeaders(EVAL_API_KEY),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; credentials: unknown };
    expect(body.success).toBe(true);
    expect(body.credentials).toBeTruthy();
  });

  it('GET /auth/internal/leagues with valid API key returns leagues', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/leagues', {
        headers: internalHeaders(EVAL_API_KEY),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('GET /auth/internal/leagues/yahoo with valid API key returns leagues', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/leagues/yahoo', {
        headers: internalHeaders(EVAL_API_KEY),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { leagues: unknown[] };
    expect(body.leagues).toEqual([]);
  });

  it('GET /auth/internal/connect/yahoo/credentials with valid API key succeeds', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/connect/yahoo/credentials', {
        headers: internalHeaders(EVAL_API_KEY),
      })
    );
    expect(res.status).toBe(200);
  });

  it('GET /auth/internal/user/preferences with valid API key returns preferences', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/user/preferences', {
        headers: internalHeaders(EVAL_API_KEY),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { defaultSport: unknown };
    expect(body).toHaveProperty('defaultSport');
  });

  // =========================================================================
  // Negative — write/admin routes blocked
  // =========================================================================

  it('POST /auth/oauth/revoke-all with API key returns 401', async () => {
    const res = await appFetch(
      makeRequest('/auth/oauth/revoke-all', {
        method: 'POST',
        headers: bearerHeaders(EVAL_API_KEY),
      })
    );
    expect(res.status).toBe(401);
  });

  it('POST /auth/extension/sync with API key returns 401', async () => {
    const res = await appFetch(
      makeRequest('/auth/extension/sync', {
        method: 'POST',
        headers: {
          ...bearerHeaders(EVAL_API_KEY),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(401);
  });

  it('PUT /auth/credentials/espn with API key returns 401', async () => {
    const res = await appFetch(
      makeRequest('/auth/credentials/espn', {
        method: 'PUT',
        headers: {
          ...bearerHeaders(EVAL_API_KEY),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ swid: 'x', s2: 'y' }),
      })
    );
    expect(res.status).toBe(401);
  });

  it('POST /auth/leagues with API key returns 401', async () => {
    const res = await appFetch(
      makeRequest('/auth/leagues', {
        method: 'POST',
        headers: {
          ...bearerHeaders(EVAL_API_KEY),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ leagues: [] }),
      })
    );
    expect(res.status).toBe(401);
  });

  it('DELETE /auth/leagues/yahoo/123 with API key returns 401', async () => {
    const res = await appFetch(
      makeRequest('/auth/leagues/yahoo/123', {
        method: 'DELETE',
        headers: bearerHeaders(EVAL_API_KEY),
      })
    );
    expect(res.status).toBe(401);
  });

  it('POST /auth/user/preferences/default-sport with API key returns 401', async () => {
    const res = await appFetch(
      makeRequest('/auth/user/preferences/default-sport', {
        method: 'POST',
        headers: {
          ...bearerHeaders(EVAL_API_KEY),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sport: 'football' }),
      })
    );
    expect(res.status).toBe(401);
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  it('wrong API key with internal token falls through to OAuth and returns 401', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/introspect', {
        headers: internalHeaders('wrong-key'),
      })
    );
    expect(res.status).toBe(401);
  });

  it('EVAL_API_KEY set without EVAL_USER_ID skips API key auth', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const envMissingUserId = { ...baseEnv, EVAL_USER_ID: undefined };

    const res = await appFetch(
      makeRequest('/auth/internal/introspect', {
        headers: internalHeaders(EVAL_API_KEY),
      }),
      envMissingUserId as any
    );
    expect(res.status).toBe(401);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('EVAL_API_KEY set but corresponding user ID missing')
    );
    consoleSpy.mockRestore();
  });

  it('neither secret set falls through to normal auth', async () => {
    const envNoSecrets = {
      ...baseEnv,
      EVAL_API_KEY: undefined,
      EVAL_USER_ID: undefined,
    };

    const res = await appFetch(
      makeRequest('/auth/internal/introspect', {
        headers: internalHeaders('some-token'),
      }),
      envNoSecrets as any
    );
    expect(res.status).toBe(401);
  });

  it('valid API key with wrong expectedResource on introspect is rejected', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/introspect', {
        headers: {
          ...internalHeaders(EVAL_API_KEY),
          'X-Flaim-Expected-Resource': 'https://evil.example.com/mcp',
        },
      })
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Resource not allowed');
  });

  it('valid API key with legacy fantasy/mcp resource passes', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/introspect', {
        headers: {
          ...internalHeaders(EVAL_API_KEY),
          'X-Flaim-Expected-Resource': 'https://api.flaim.app/fantasy/mcp',
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean };
    expect(body.valid).toBe(true);
  });

  it('equal-length wrong key is still rejected', async () => {
    // Same length as EVAL_API_KEY but different content
    const wrongKey = 'flaim_eval_xyz789wrongkey';
    const res = await appFetch(
      makeRequest('/auth/internal/introspect', {
        headers: internalHeaders(wrongKey),
      })
    );
    expect(res.status).toBe(401);
  });

  // =========================================================================
  // Regression — OAuth fallback when API key is configured
  // =========================================================================

  it('OAuth token still works when EVAL_API_KEY is configured', async () => {
    // Import the mock so we can override behavior for this test
    const { validateOAuthToken } = await import('../oauth-handlers');
    const mockValidate = validateOAuthToken as ReturnType<typeof vi.fn>;
    mockValidate.mockResolvedValueOnce({
      userId: 'user_oauth_regular',
      scope: 'mcp:read',
    });

    const res = await appFetch(
      makeRequest('/auth/internal/introspect', {
        headers: {
          ...internalHeaders('valid-oauth-token-not-api-key'),
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; userId: string };
    expect(body.valid).toBe(true);
    expect(body.userId).toBe('user_oauth_regular');
  });

  it('GET /auth/credentials/espn without ?raw=true rejects API key (no opt-in)', async () => {
    const res = await appFetch(
      makeRequest('/auth/credentials/espn', {
        headers: bearerHeaders(EVAL_API_KEY),
      })
    );
    expect(res.status).toBe(401);
  });

  it('GET /auth/credentials/espn?forEdit=true rejects API key (no opt-in)', async () => {
    const res = await appFetch(
      makeRequest('/auth/credentials/espn?forEdit=true', {
        headers: bearerHeaders(EVAL_API_KEY),
      })
    );
    expect(res.status).toBe(401);
  });

  // Test H: DELETE /internal/leagues/default/:sport with no auth → 401/403
  it('DELETE /auth/internal/leagues/default/football without internal token returns 403', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/leagues/default/football', {
        method: 'DELETE',
        headers: bearerHeaders(EVAL_API_KEY), // Bearer only — no X-Flaim-Internal-Token
      })
    );
    expect(res.status).toBe(403);
  });

  it('DELETE /auth/internal/leagues/default/football without any auth returns 4xx', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/leagues/default/football', {
        method: 'DELETE',
      })
    );
    // Route uses getInternalUserId which checks internal service token first;
    // missing internal token → 403, missing bearer → 401; either is a rejection.
    expect([401, 403]).toContain(res.status);
  });

  // Test I: DELETE /internal/leagues/default/:sport with invalid sport → 400
  it('DELETE /auth/internal/leagues/default/soccer with valid auth returns 400 for invalid sport', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/leagues/default/soccer', {
        method: 'DELETE',
        headers: internalHeaders(EVAL_API_KEY),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid sport');
  });

  it('internal helper route rejects requests missing internal token', async () => {
    const res = await appFetch(
      makeRequest('/auth/internal/credentials/espn/raw', {
        headers: bearerHeaders(EVAL_API_KEY),
      })
    );
    expect(res.status).toBe(403);
  });

  it('public Yahoo credentials route rejects eval API key', async () => {
    const res = await appFetch(
      makeRequest('/auth/connect/yahoo/status', {
        headers: bearerHeaders(EVAL_API_KEY),
      })
    );
    expect(res.status).toBe(401);
  });

  it('GET /authorize returns 429 when rate limited', async () => {
    const rateLimitedEnv = {
      ...baseEnv,
      TOKEN_RATE_LIMITER: { limit: async () => ({ success: false }) },
    };

    const res = await appFetch(
      makeRequest('/authorize?response_type=code&client_id=test&redirect_uri=https://claude.ai/callback&code_challenge=abc&code_challenge_method=S256'),
      rateLimitedEnv as any
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('rate_limit_exceeded');
  });
});
