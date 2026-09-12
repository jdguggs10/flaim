import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleSyncCredentials,
  handleGetExtensionStatus,
  handleGetConnection,
  type ExtensionEnv,
} from '../extension-handlers';
import { EspnSupabaseStorage } from '../supabase-storage';

const mutationMocks = vi.hoisted(() => ({
  begin: vi.fn(),
  durableEnabled: vi.fn(),
  historyFromEnvironment: vi.fn(),
  settle: vi.fn(),
  syncFromEnvironment: vi.fn(),
}));

vi.mock('../supabase-storage', () => ({
  EspnSupabaseStorage: {
    fromEnvironment: vi.fn(),
  },
}));

vi.mock('../espn-history', () => ({
  beginEspnLeagueMutation: mutationMocks.begin,
  durableHistoryEnabledFor: mutationMocks.durableEnabled,
  EspnHistoryJobStorage: {
    fromEnvironment: mutationMocks.historyFromEnvironment,
  },
}));

vi.mock('../sync-state', () => ({
  SyncStateStorage: {
    fromEnvironment: mutationMocks.syncFromEnvironment,
  },
}));

const env: ExtensionEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
};

const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
const userId = 'user_abc123';

const VALID_SWID = '{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}';
const VALID_S2 = 'A'.repeat(60);

describe('handleSyncCredentials', () => {
  let mockStorage: {
    setCredentials: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = { setCredentials: vi.fn().mockResolvedValue(true) };
    mutationMocks.durableEnabled.mockReturnValue(false);
    mutationMocks.begin.mockResolvedValue({ jobId: null, ownerId: 'league-mutation:test' });
    mutationMocks.settle.mockResolvedValue(undefined);
    mutationMocks.syncFromEnvironment.mockReturnValue({ settle: mutationMocks.settle });
    vi.mocked(EspnSupabaseStorage.fromEnvironment).mockReturnValue(
      mockStorage as unknown as EspnSupabaseStorage
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 and stores valid credentials', async () => {
    const req = new Request('https://api.flaim.app/extension/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swid: VALID_SWID, s2: VALID_S2 }),
    });

    const res = await handleSyncCredentials(req, env, userId, corsHeaders);
    expect(res.status).toBe(200);

    const body = await res.json() as { success?: boolean };
    expect(body.success).toBe(true);
    expect(mutationMocks.begin).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ settle: mutationMocks.settle }),
      userId
    );
    expect(mockStorage.setCredentials).toHaveBeenCalledWith(userId, VALID_SWID, VALID_S2);
    expect(mutationMocks.settle).toHaveBeenCalledWith(userId, 'espn', 'league-mutation:test', {
      status: 'skipped',
      cooldownSeconds: 0,
      syncSource: 'extension',
    });
  });

  it('returns 400 when swid is missing', async () => {
    const req = new Request('https://api.flaim.app/extension/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ s2: VALID_S2 }),
    });

    const res = await handleSyncCredentials(req, env, userId, corsHeaders);
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('invalid_request');
    expect(mutationMocks.begin).not.toHaveBeenCalled();
  });

  it('returns 400 when s2 is missing', async () => {
    const req = new Request('https://api.flaim.app/extension/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swid: VALID_SWID }),
    });

    const res = await handleSyncCredentials(req, env, userId, corsHeaders);
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('invalid_request');
  });

  it('returns 400 for invalid SWID format (no curly braces)', async () => {
    const req = new Request('https://api.flaim.app/extension/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swid: 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890', s2: VALID_S2 }),
    });

    const res = await handleSyncCredentials(req, env, userId, corsHeaders);
    expect(res.status).toBe(400);
    const body = await res.json() as { error_description?: string };
    expect(body.error_description).toContain('SWID');
  });

  it('returns 400 for s2 that is too short', async () => {
    const req = new Request('https://api.flaim.app/extension/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swid: VALID_SWID, s2: 'tooshort' }),
    });

    const res = await handleSyncCredentials(req, env, userId, corsHeaders);
    expect(res.status).toBe(400);
    const body = await res.json() as { error_description?: string };
    expect(body.error_description).toContain('espn_s2');
  });

  it('returns 500 when storage fails to save', async () => {
    mockStorage.setCredentials.mockResolvedValue(false);

    const req = new Request('https://api.flaim.app/extension/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swid: VALID_SWID, s2: VALID_S2 }),
    });

    const res = await handleSyncCredentials(req, env, userId, corsHeaders);
    expect(res.status).toBe(500);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('server_error');
    expect(mutationMocks.settle).toHaveBeenCalledOnce();
  });

  it('fails closed before storing when the provider mutation fence cannot be taken', async () => {
    mutationMocks.begin.mockRejectedValueOnce(new Error('lease unavailable'));

    const req = new Request('https://api.flaim.app/extension/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ swid: VALID_SWID, s2: VALID_S2 }),
    });

    const res = await handleSyncCredentials(req, env, userId, corsHeaders);
    expect(res.status).toBe(500);
    expect(mockStorage.setCredentials).not.toHaveBeenCalled();
    expect(mutationMocks.settle).not.toHaveBeenCalled();
  });

  it('returns 400 when request body is invalid JSON', async () => {
    const req = new Request('https://api.flaim.app/extension/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not-json',
    });

    const res = await handleSyncCredentials(req, env, userId, corsHeaders);
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string; error_description?: string };
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toBe('Invalid request body');
  });
});

describe('handleGetExtensionStatus', () => {
  let mockStorage: {
    hasCredentials: ReturnType<typeof vi.fn>;
    getCredentialMetadata: ReturnType<typeof vi.fn>;
    getUserPreferences: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = {
      hasCredentials: vi.fn().mockResolvedValue(true),
      getCredentialMetadata: vi.fn().mockResolvedValue({ hasCredentials: true, lastUpdated: '2025-01-01T00:00:00Z' }),
      getUserPreferences: vi.fn().mockResolvedValue({
        defaultSport: 'football',
        defaultFootball: null,
        defaultBaseball: null,
        defaultBasketball: null,
        defaultHockey: null,
      }),
    };
    vi.mocked(EspnSupabaseStorage.fromEnvironment).mockReturnValue(
      mockStorage as unknown as EspnSupabaseStorage
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns connected status with credentials and preferences', async () => {
    const res = await handleGetExtensionStatus(env, userId, corsHeaders);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      success?: boolean;
      connected?: boolean;
      hasCredentials?: boolean;
      lastSync?: string | null;
      preferences?: { defaultSport?: string };
    };
    expect(body.success).toBe(true);
    expect(body.connected).toBe(true);
    expect(body.hasCredentials).toBe(true);
    expect(body.lastSync).toBe('2025-01-01T00:00:00Z');
    expect(body.preferences?.defaultSport).toBe('football');
  });

  it('returns hasCredentials false when no credentials stored', async () => {
    mockStorage.hasCredentials.mockResolvedValue(false);
    mockStorage.getCredentialMetadata.mockResolvedValue({ hasCredentials: false });

    const res = await handleGetExtensionStatus(env, userId, corsHeaders);
    expect(res.status).toBe(200);

    const body = await res.json() as { connected?: boolean; hasCredentials?: boolean };
    expect(body.connected).toBe(false);
    expect(body.hasCredentials).toBe(false);
  });
});

describe('handleGetConnection', () => {
  let mockStorage: {
    hasCredentials: ReturnType<typeof vi.fn>;
    getCredentialMetadata: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = {
      hasCredentials: vi.fn().mockResolvedValue(true),
      getCredentialMetadata: vi.fn().mockResolvedValue({ hasCredentials: true, lastUpdated: '2025-06-01T00:00:00Z' }),
    };
    vi.mocked(EspnSupabaseStorage.fromEnvironment).mockReturnValue(
      mockStorage as unknown as EspnSupabaseStorage
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns connected=true when credentials exist', async () => {
    const res = await handleGetConnection(env, userId, corsHeaders);
    expect(res.status).toBe(200);

    const body = await res.json() as { success?: boolean; connected?: boolean; token?: null; lastSync?: string };
    expect(body.success).toBe(true);
    expect(body.connected).toBe(true);
    expect(body.token).toBeNull();
    expect(body.lastSync).toBe('2025-06-01T00:00:00Z');
  });

  it('returns connected=false when no credentials exist', async () => {
    mockStorage.hasCredentials.mockResolvedValue(false);
    mockStorage.getCredentialMetadata.mockResolvedValue(null);

    const res = await handleGetConnection(env, userId, corsHeaders);
    expect(res.status).toBe(200);

    const body = await res.json() as { connected?: boolean };
    expect(body.connected).toBe(false);
  });
});
