import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  MAX_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  MIN_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  OAuthStorage,
} from '../oauth-storage';
import {
  createClientBoundToken,
  createConfidentialClientRegistration,
  getClientIdFromBoundToken,
} from '../oauth-client-auth';
import { isMissingTokenRpcError } from '../token-rpc-compat';

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const clientSigningKey = 'test-key';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

function buildTableMock(options?: {
  lookupRow?: Record<string, unknown> | null;
  lookupError?: unknown;
  insertId?: string;
  refreshableRows?: Record<string, unknown>[];
  refreshableError?: unknown;
}) {
  const insertPayloads: Record<string, unknown>[] = [];

  const refreshableLimit = vi.fn().mockResolvedValue({
    data: options?.refreshableRows ?? [],
    error: options?.refreshableError ?? null,
  });
  const refreshableGt = vi.fn().mockReturnValue({ limit: refreshableLimit });
  const refreshableNot = vi.fn().mockReturnValue({ gt: refreshableGt });
  const refreshableIs = vi.fn().mockReturnValue({ not: refreshableNot });

  const lookupSingle = vi.fn().mockResolvedValue({
    data: options?.lookupRow ?? null,
    error: options?.lookupError ?? null,
  });
  const insertSingle = vi.fn().mockResolvedValue({
    data: { id: options?.insertId ?? 'token-id' },
    error: null,
  });

  const selectEq = vi.fn().mockReturnValue({
    single: lookupSingle,
    is: refreshableIs,
  });
  const select = vi.fn((columns?: string) => {
    if (columns === '*') {
      return { eq: selectEq };
    }

    return { single: insertSingle };
  });

  const insert = vi.fn((payload: Record<string, unknown>) => {
    insertPayloads.push(payload);
    return { select };
  });

  const updateEq = vi.fn().mockReturnValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const table = {
    insert,
    select,
    update,
  };

  mockFrom.mockReturnValue(table);
  const rpcMaybeSingle = vi.fn().mockResolvedValue({
    data: options?.lookupRow ?? null,
    error: options?.lookupError ?? null,
  });
  mockRpc.mockReturnValue({ maybeSingle: rpcMaybeSingle });

  return {
    insertPayloads,
    insert,
    select,
    selectEq,
    refreshableIs,
    refreshableNot,
    refreshableGt,
    refreshableLimit,
    lookupSingle,
    update,
    updateEq,
    rpcMaybeSingle,
  };
}

describe('OAuthStorage MCP token lifetimes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('defaults refresh-token inactivity TTL to 1 year', async () => {
    const { insertPayloads } = buildTableMock();
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const before = Date.now();
    await storage.createAccessToken({
      userId: 'user_123',
      scope: 'mcp:read',
      includeRefreshToken: true,
    });
    const after = Date.now();

    const refreshTokenExpiresAt = new Date(insertPayloads[0].refresh_token_expires_at as string).getTime();
    expect(refreshTokenExpiresAt).toBeGreaterThanOrEqual(
      before + DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000 - 1000
    );
    expect(refreshTokenExpiresAt).toBeLessThanOrEqual(
      after + DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000 + 1000
    );
  });

  it('uses OAUTH_REFRESH_TOKEN_TTL_SECONDS env override', async () => {
    const { insertPayloads } = buildTableMock();
    const storage = OAuthStorage.fromEnvironment({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
      OAUTH_REFRESH_TOKEN_TTL_SECONDS: '1209600',
    });

    const before = Date.now();
    await storage.createAccessToken({
      userId: 'user_123',
      includeRefreshToken: true,
    });
    const after = Date.now();

    const refreshTokenExpiresAt = new Date(insertPayloads[0].refresh_token_expires_at as string).getTime();
    expect(refreshTokenExpiresAt).toBeGreaterThanOrEqual(before + 1209600 * 1000 - 1000);
    expect(refreshTokenExpiresAt).toBeLessThanOrEqual(after + 1209600 * 1000 + 1000);
  });

  it('marks confidential authorization codes with the client binding', async () => {
    const { insertPayloads } = buildTableMock();
    const client = await createConfidentialClientRegistration(clientSigningKey);
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const code = await storage.createAuthorizationCode({
      userId: 'user_123',
      redirectUri: 'https://www.perplexity.ai/rest/connections/oauth_callback',
      clientId: client.clientId,
    });

    expect(getClientIdFromBoundToken('mcp_ac', code)).toBe(client.clientId);
    expect(insertPayloads[0].code).toBe(code);
  });

  it('marks confidential refresh tokens with the client binding', async () => {
    const { insertPayloads } = buildTableMock();
    const client = await createConfidentialClientRegistration(clientSigningKey);
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const token = await storage.createAccessToken({
      userId: 'user_123',
      includeRefreshToken: true,
      clientId: client.clientId,
    });

    expect(token.refreshToken).toBeTruthy();
    expect(getClientIdFromBoundToken('mcp_rt', token.refreshToken)).toBe(client.clientId);
    expect(insertPayloads[0].refresh_token).toBe(token.refreshToken);
  });

  it('caps oversized OAUTH_REFRESH_TOKEN_TTL_SECONDS env override at 1 year', async () => {
    const { insertPayloads } = buildTableMock();
    const storage = OAuthStorage.fromEnvironment({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
      OAUTH_REFRESH_TOKEN_TTL_SECONDS: '9999999999',
    });

    const before = Date.now();
    await storage.createAccessToken({
      userId: 'user_123',
      includeRefreshToken: true,
    });
    const after = Date.now();

    const refreshTokenExpiresAt = new Date(insertPayloads[0].refresh_token_expires_at as string).getTime();
    expect(refreshTokenExpiresAt).toBeGreaterThanOrEqual(
      before + MAX_OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000 - 1000
    );
    expect(refreshTokenExpiresAt).toBeLessThanOrEqual(
      after + MAX_OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000 + 1000
    );
  });

  it('clamps OAUTH_REFRESH_TOKEN_TTL_SECONDS env override to the 1-hour minimum', async () => {
    const { insertPayloads } = buildTableMock();
    const storage = OAuthStorage.fromEnvironment({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
      OAUTH_REFRESH_TOKEN_TTL_SECONDS: String(MIN_OAUTH_REFRESH_TOKEN_TTL_SECONDS - 1),
    });

    const before = Date.now();
    await storage.createAccessToken({
      userId: 'user_123',
      includeRefreshToken: true,
    });
    const after = Date.now();

    const refreshTokenExpiresAt = new Date(insertPayloads[0].refresh_token_expires_at as string).getTime();
    expect(refreshTokenExpiresAt).toBeGreaterThanOrEqual(
      before + MIN_OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000 - 1000
    );
    expect(refreshTokenExpiresAt).toBeLessThanOrEqual(
      after + MIN_OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000 + 1000
    );
  });

  it('refresh rotation carries forward the configured refresh-token TTL', async () => {
    const { insertPayloads } = buildTableMock({
      lookupRow: {
        user_id: 'user_123',
        scope: 'mcp:read',
        resource: 'https://api.flaim.app/mcp',
        client_name: 'Perplexity',
      },
      insertId: 'new-token-id',
    });
    const storage = OAuthStorage.fromEnvironment({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
      OAUTH_REFRESH_TOKEN_TTL_SECONDS: '2592000',
    });

    const before = Date.now();
    const token = await storage.refreshAccessToken('old-refresh-token');
    const after = Date.now();

    expect(token).not.toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('claim_mcp_oauth_refresh_token', {
      p_refresh_token: 'old-refresh-token',
    });
    expect(insertPayloads[0].grant_type).toBe('refresh_token');
    const refreshTokenExpiresAt = new Date(insertPayloads[0].refresh_token_expires_at as string).getTime();
    expect(refreshTokenExpiresAt).toBeGreaterThanOrEqual(before + 2592000 * 1000 - 1000);
    expect(refreshTokenExpiresAt).toBeLessThanOrEqual(after + 2592000 * 1000 + 1000);
  });

  it('records grant_type=authorization_code when exchanging an authorization code', async () => {
    const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
    const code = 'plain-auth-code';

    const claimMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        user_id: 'user_123',
        redirect_uri: redirectUri,
        code_challenge: null,
        code_challenge_method: null,
        scope: 'mcp:read',
        resource: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      error: null,
    });
    mockRpc.mockReturnValue({ maybeSingle: claimMaybeSingle });

    const insertPayloads: Record<string, unknown>[] = [];
    const insertSingle = vi.fn().mockResolvedValue({ data: { id: 'token-id' }, error: null });
    const insertSelect = vi.fn().mockReturnValue({ single: insertSingle });
    const insert = vi.fn((payload: Record<string, unknown>) => {
      insertPayloads.push(payload);
      return { select: insertSelect };
    });

    mockFrom.mockReturnValue({ insert });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const token = await storage.exchangeCodeForToken(code, redirectUri);

    expect(token).not.toBeNull();
    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0].grant_type).toBe('authorization_code');
  });

  it('refresh rotation preserves confidential client binding', async () => {
    const client = await createConfidentialClientRegistration(clientSigningKey);
    const refreshToken = createClientBoundToken('mcp_rt', client.clientId, 'old-refresh-token');
    const { insertPayloads } = buildTableMock({
      lookupRow: {
        user_id: 'user_123',
        scope: 'mcp:read',
        client_name: 'Perplexity',
      },
      insertId: 'new-token-id',
    });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const token = await storage.refreshAccessToken(refreshToken, client.clientId);

    expect(token?.refreshToken).toBeTruthy();
    expect(getClientIdFromBoundToken('mcp_rt', token?.refreshToken)).toBe(client.clientId);
    expect(insertPayloads[0].refresh_token).toBe(token?.refreshToken);
  });

  it('rejects confidential authorization code exchange when client binding mismatches', async () => {
    const client = await createConfidentialClientRegistration(clientSigningKey);
    const otherClient = await createConfidentialClientRegistration(clientSigningKey);
    const code = createClientBoundToken('mcp_ac', client.clientId, 'auth-code');
    const redirectUri = 'https://www.perplexity.ai/rest/connections/oauth_callback';
    const insert = vi.fn();
    mockFrom.mockReturnValue({ insert });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const token = await storage.exchangeCodeForToken(code, redirectUri, undefined, otherClient.clientId);

    expect(token).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not fall back when the authorization-code RPC is denied', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    mockRpc.mockReturnValue({ maybeSingle });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(
      storage.exchangeCodeForToken(
        'plain-auth-code',
        'https://claude.ai/api/mcp/auth_callback'
      )
    ).resolves.toBeNull();

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns null when the refresh-token claim does not win', async () => {
    buildTableMock({ lookupRow: null });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(storage.refreshAccessToken('old-refresh-token')).resolves.toBeNull();
  });

  it('does not fall back when the refresh-token RPC is denied', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    mockRpc.mockReturnValue({ maybeSingle });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(
      storage.refreshAccessToken('old-refresh-token')
    ).resolves.toBeNull();

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('allows only one of two simultaneous refresh callers to rotate a token', async () => {
    const { insertPayloads } = buildTableMock();
    mockRpc
      .mockReturnValueOnce({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            user_id: 'user_123',
            scope: 'mcp:read',
            resource: null,
            client_name: 'ChatGPT',
          },
          error: null,
        }),
      })
      .mockReturnValueOnce({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const results = await Promise.all([
      storage.refreshAccessToken('old-refresh-token'),
      storage.refreshAccessToken('old-refresh-token'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(insertPayloads).toHaveLength(1);
  });

  it('gets refreshable user tokens using refresh-token expiry, not access-token expiry', async () => {
    const expiredAccessToken = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const validRefreshToken = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { refreshableIs, refreshableNot, refreshableGt, refreshableLimit } = buildTableMock({
      refreshableRows: [
        {
          id: 'token-id',
          access_token: 'expired-access-token',
          user_id: 'user_123',
          scope: 'mcp:read',
          resource: 'https://api.flaim.app/mcp',
          client_name: 'Perplexity',
          expires_at: expiredAccessToken,
          refresh_token: 'valid-refresh-token',
          refresh_token_expires_at: validRefreshToken,
        },
      ],
    });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const tokens = await storage.getRefreshableUserTokens('user_123');

    expect(tokens).toHaveLength(1);
    expect(tokens[0].accessToken).toBe('expired-access-token');
    expect(tokens[0].refreshToken).toBe('valid-refresh-token');
    expect(refreshableIs).toHaveBeenCalledWith('revoked_at', null);
    expect(refreshableNot).toHaveBeenCalledWith('refresh_token', 'is', null);
    expect(refreshableGt).toHaveBeenCalledWith('refresh_token_expires_at', expect.any(String));
    expect(refreshableLimit).toHaveBeenCalledWith(50);
  });

  it('returns no refreshable user tokens when none match', async () => {
    const { refreshableLimit } = buildTableMock({ refreshableRows: [] });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(storage.getRefreshableUserTokens('user_123')).resolves.toEqual([]);
    expect(refreshableLimit).toHaveBeenCalledWith(50);
  });

  it('treats active connection status as refreshable token status', async () => {
    buildTableMock({
      refreshableRows: [
        {
          id: 'token-id',
          access_token: 'expired-access-token',
          user_id: 'user_123',
          scope: 'mcp:read',
          expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          refresh_token: 'valid-refresh-token',
          refresh_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(storage.hasActiveConnection('user_123')).resolves.toBe(true);
  });
});

describe('OAuthStorage token RPC routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('validates an access token through a body-based RPC', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        user_id: 'user_123',
        scope: 'mcp:read',
        resource: 'https://api.flaim.app/mcp',
        client_name: 'ChatGPT',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        revoked_at: null,
      },
      error: null,
    });
    mockRpc.mockReturnValue({ maybeSingle });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(
      storage.validateAccessToken(
        'synthetic-access-token',
        'https://api.flaim.app/mcp'
      )
    ).resolves.toEqual({
      valid: true,
      userId: 'user_123',
      scope: 'mcp:read',
      resource: 'https://api.flaim.app/mcp',
      clientName: 'ChatGPT',
    });

    expect(mockRpc).toHaveBeenCalledWith('find_mcp_oauth_access_token', {
      p_access_token: 'synthetic-access-token',
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('uses the pre-migration access-token path only when the RPC is missing', async () => {
    const rpcMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'function is missing' },
    });
    const legacyMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        user_id: 'user_123',
        scope: 'mcp:read',
        resource: 'https://api.flaim.app/mcp',
        client_name: 'ChatGPT',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        revoked_at: null,
      },
      error: null,
    });
    const legacyEq = vi.fn().mockReturnValue({ maybeSingle: legacyMaybeSingle });
    const legacySelect = vi.fn().mockReturnValue({ eq: legacyEq });
    mockRpc.mockReturnValue({ maybeSingle: rpcMaybeSingle });
    mockFrom.mockReturnValue({ select: legacySelect });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(
      storage.validateAccessToken(
        'synthetic-access-token',
        'https://api.flaim.app/mcp'
      )
    ).resolves.toEqual({
      valid: true,
      userId: 'user_123',
      scope: 'mcp:read',
      resource: 'https://api.flaim.app/mcp',
      clientName: 'ChatGPT',
    });

    expect(mockFrom).toHaveBeenCalledWith('oauth_tokens');
    expect(legacyEq).toHaveBeenCalledWith(
      'access_token',
      'synthetic-access-token'
    );
  });

  it('does not fall back when the token RPC is denied', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    mockRpc.mockReturnValue({ maybeSingle });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(
      storage.validateAccessToken('synthetic-access-token')
    ).resolves.toEqual({
      valid: false,
      error: 'Token not found',
    });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('revokes an access token through a body-based RPC', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(storage.revokeToken('synthetic-access-token')).resolves.toBe(true);

    expect(mockRpc).toHaveBeenCalledWith('revoke_mcp_oauth_access_token', {
      p_access_token: 'synthetic-access-token',
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not fall back when the token-revocation RPC is denied', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(
      storage.revokeToken('synthetic-access-token')
    ).resolves.toBe(false);

    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('token RPC compatibility error routing', () => {
  it('recognizes only PostgREST missing-function errors', () => {
    expect(isMissingTokenRpcError({ code: 'PGRST202' })).toBe(true);
    expect(isMissingTokenRpcError({ code: '42501' })).toBe(false);
    expect(isMissingTokenRpcError({ code: 'PGRST116' })).toBe(false);
    expect(isMissingTokenRpcError(null)).toBe(false);
  });
});

describe('OAuthStorage authorization state binding', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('stores the consented scope with the authorization state binding', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await storage.createOAuthState({
      state: 'state-123',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: 'client-123',
      scope: 'mcp:read mcp:write',
      codeChallenge: 'challenge-123',
      resource: 'https://api.flaim.app/mcp',
    });

    expect(mockRpc).toHaveBeenCalledWith('create_mcp_oauth_state', {
      p_state: 'state-123',
      p_redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      p_binding: 'oauth-state-v1:{"clientId":"client-123","scope":"mcp:read mcp:write","codeChallenge":"challenge-123","resource":"https://api.flaim.app/mcp"}',
      p_expires_at: expect.any(String),
    });
  });

  it('accepts an identical retry for a stateless authorization transaction', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(storage.createOAuthState({
      state: 'pkce:challenge-123',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: 'client-123',
      scope: 'mcp:read',
      codeChallenge: 'challenge-123',
      resource: 'https://api.flaim.app/mcp',
    })).resolves.toBeUndefined();

    expect(mockRpc).toHaveBeenCalledOnce();
  });

  it('rejects a stateless retry when the PKCE key belongs to a different binding', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(storage.createOAuthState({
      state: 'pkce:challenge-123',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: 'client-123',
      scope: 'mcp:read mcp:write',
      codeChallenge: 'challenge-123',
      resource: 'https://api.flaim.app/mcp',
    })).rejects.toThrow('Failed to store OAuth state');
  });

  it('rejects a stateless retry when the existing row is expired and the exact lookup finds no match', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(storage.createOAuthState({
      state: 'pkce:challenge-123',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: 'client-123',
      scope: 'mcp:read',
      codeChallenge: 'challenge-123',
      resource: 'https://api.flaim.app/mcp',
    })).rejects.toThrow('Failed to store OAuth state');

    expect(mockRpc).toHaveBeenCalledOnce();
  });

  it('rejects a stateless retry when the exact-binding lookup fails', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'lookup failed' },
    });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(storage.createOAuthState({
      state: 'pkce:challenge-123',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: 'client-123',
      scope: 'mcp:read',
      codeChallenge: 'challenge-123',
      resource: 'https://api.flaim.app/mcp',
    })).rejects.toThrow('Failed to store OAuth state');
  });

  it('fails closed when the state RPC is denied', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(storage.createOAuthState({
      state: 'pkce:challenge-123',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: 'client-123',
      scope: 'mcp:read',
      codeChallenge: 'challenge-123',
      resource: 'https://api.flaim.app/mcp',
    })).rejects.toThrow('Failed to store OAuth state');

    expect(mockRpc).toHaveBeenCalledOnce();
  });

  it('atomically claims state with the exact transaction binding and expiry', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const result = await storage.consumeOAuthState(
      'state-123',
      'https://claude.ai/api/mcp/auth_callback',
      'client-123',
      'mcp:read',
      'challenge-123',
      'https://api.flaim.app/mcp'
    );

    expect(result).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('consume_mcp_oauth_state', {
      p_state: 'state-123',
      p_redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      p_binding: 'oauth-state-v1:{"clientId":"client-123","scope":"mcp:read","codeChallenge":"challenge-123","resource":"https://api.flaim.app/mcp"}',
    });
  });

  it.each([
    ['scope', { scope: 'mcp:read mcp:write' }],
    ['PKCE challenge', { codeChallenge: 'mutated-challenge' }],
    ['resource', { resource: 'https://api.flaim.app/fantasy/mcp' }],
    ['client', { clientId: 'mutated-client' }],
    ['redirect', { redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect' }],
    ['loopback redirect spelling', { redirectUri: 'http://127.0.0.1:8787/callback' }],
  ])('rejects a %s mismatch without consuming the state', async (_name, mutation) => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const submitted = {
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: 'client-123',
      scope: 'mcp:read',
      codeChallenge: 'challenge-123',
      resource: 'https://api.flaim.app/mcp',
      ...mutation,
    };
    const result = await storage.consumeOAuthState(
      'state-123',
      submitted.redirectUri,
      submitted.clientId,
      submitted.scope,
      submitted.codeChallenge,
      submitted.resource
    );

    expect(result).toBe(false);
    expect(mockRpc).toHaveBeenCalledWith('consume_mcp_oauth_state', {
      p_state: 'state-123',
      p_redirect_uri: submitted.redirectUri,
      p_binding: `oauth-state-v1:${JSON.stringify({
        clientId: submitted.clientId,
        scope: submitted.scope,
        codeChallenge: submitted.codeChallenge,
        resource: submitted.resource,
      })}`,
    });
  });

  it('returns false when the atomic delete fails', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'delete failed' },
    });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const result = await storage.consumeOAuthState(
      'state-123',
      'https://claude.ai/api/mcp/auth_callback',
      'client-123',
      'mcp:read',
      'challenge-123',
      'https://api.flaim.app/mcp'
    );

    expect(result).toBe(false);
  });

  it('returns false when no state row is deleted', async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const result = await storage.consumeOAuthState(
      'state-123',
      'https://claude.ai/api/mcp/auth_callback',
      'client-123',
      'mcp:read',
      'challenge-123',
      'https://api.flaim.app/mcp'
    );

    expect(result).toBe(false);
  });

  it('allows only one of two concurrent consumers to claim the state', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');
    const consume = () => storage.consumeOAuthState(
      'state-123',
      'https://claude.ai/api/mcp/auth_callback',
      'client-123',
      'mcp:read',
      'challenge-123',
      'https://api.flaim.app/mcp'
    );

    const results = await Promise.all([consume(), consume()]);

    expect(results).toEqual([true, false]);
  });
});
