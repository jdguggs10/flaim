import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS, OAuthStorage } from '../oauth-storage';

const mockFrom = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

function buildTableMock(options?: {
  lookupRow?: Record<string, unknown> | null;
  lookupError?: unknown;
  insertId?: string;
}) {
  const insertPayloads: Record<string, unknown>[] = [];

  const lookupSingle = vi.fn().mockResolvedValue({
    data: options?.lookupRow ?? null,
    error: options?.lookupError ?? null,
  });
  const insertSingle = vi.fn().mockResolvedValue({
    data: { id: options?.insertId ?? 'token-id' },
    error: null,
  });

  const selectEq = vi.fn().mockReturnValue({ single: lookupSingle });
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

  it('defaults refresh-token inactivity TTL to 90 days', async () => {
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
});
