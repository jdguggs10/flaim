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

const mockFrom = vi.fn();
const clientSigningKey = 'test-key';

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
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
    const { insertPayloads, updateEq } = buildTableMock({
      lookupRow: {
        access_token: 'old-access-token',
        refresh_token: 'old-refresh-token',
        refresh_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        revoked_at: null,
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
    expect(updateEq).toHaveBeenCalledWith('access_token', 'old-access-token');
    const refreshTokenExpiresAt = new Date(insertPayloads[0].refresh_token_expires_at as string).getTime();
    expect(refreshTokenExpiresAt).toBeGreaterThanOrEqual(before + 2592000 * 1000 - 1000);
    expect(refreshTokenExpiresAt).toBeLessThanOrEqual(after + 2592000 * 1000 + 1000);
  });

  it('refresh rotation preserves confidential client binding', async () => {
    const client = await createConfidentialClientRegistration(clientSigningKey);
    const refreshToken = createClientBoundToken('mcp_rt', client.clientId, 'old-refresh-token');
    const { insertPayloads } = buildTableMock({
      lookupRow: {
        access_token: 'old-access-token',
        refresh_token: refreshToken,
        refresh_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        revoked_at: null,
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
    const single = vi.fn().mockResolvedValue({
      data: {
        code,
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
    const select = vi.fn().mockReturnValue({ single });
    const gt = vi.fn().mockReturnValue({ select });
    const is = vi.fn().mockReturnValue({ gt });
    const eq = vi.fn().mockReturnValue({ is });
    const update = vi.fn().mockReturnValue({ eq });
    const insert = vi.fn();
    mockFrom.mockReturnValue({ update, insert });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    const token = await storage.exchangeCodeForToken(code, redirectUri, undefined, otherClient.clientId);

    expect(token).toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects expired refresh tokens', async () => {
    buildTableMock({
      lookupRow: {
        access_token: 'old-access-token',
        refresh_token: 'old-refresh-token',
        refresh_token_expires_at: new Date(Date.now() - 60_000).toISOString(),
        revoked_at: null,
        user_id: 'user_123',
        scope: 'mcp:read',
      },
    });
    const storage = new OAuthStorage('https://example.supabase.co', 'test-key');

    await expect(storage.refreshAccessToken('old-refresh-token')).resolves.toBeNull();
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
