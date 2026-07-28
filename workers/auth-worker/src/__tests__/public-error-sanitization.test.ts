import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../index-hono';

const RAW_SUPABASE_ERROR = 'raw Supabase password=secret failed';
const RAW_THROWN_ERROR = 'raw OAuth secret stack failed';

const { mockProbeConnection, mockMetadataDiscovery } = vi.hoisted(() => ({
  mockProbeConnection: vi.fn(),
  mockMetadataDiscovery: vi.fn(),
}));

vi.mock('../supabase-storage', () => {
  return {
    EspnSupabaseStorage: {
      fromEnvironment: vi.fn().mockReturnValue({
        probeConnection: mockProbeConnection,
      }),
    },
  };
});

vi.mock('../oauth-handlers', () => ({
  handleMetadataDiscovery: mockMetadataDiscovery,
  handleClientRegistration: vi.fn(),
  handleAuthorize: vi.fn(),
  handleCreateCode: vi.fn(),
  handleToken: vi.fn(),
  handleRevoke: vi.fn(),
  handleCheckStatus: vi.fn(),
  handleRevokeAll: vi.fn(),
  handleRevokeSingle: vi.fn(),
  validateOAuthToken: vi.fn().mockResolvedValue(null),
}));

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-service-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
  TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CREDENTIALS_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function makeRequest(path: string): Request {
  return new Request(`https://api.flaim.app${path}`);
}

describe('public error sanitization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports Supabase connected only after the connectivity probe succeeds', async () => {
    mockProbeConnection.mockResolvedValue(undefined);

    const response = await app.fetch(makeRequest('/auth/health'), baseEnv);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.supabase_status).toBe('connected');
    expect(mockProbeConnection).toHaveBeenCalledOnce();
  });

  it('sanitizes Supabase health check failures while logging details', async () => {
    mockProbeConnection.mockRejectedValue(new Error(RAW_SUPABASE_ERROR));

    const response = await app.fetch(makeRequest('/auth/health'), baseEnv);
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.supabase_status).toBe('error');
    expect(body.supabase_error).toBe('supabase_connectivity_check_failed');
    expect(text).not.toContain(RAW_SUPABASE_ERROR);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[auth-worker] Supabase health check failed:',
      expect.any(Error)
    );
  });

  it('returns degraded when Supabase is not configured', async () => {
    const response = await app.fetch(makeRequest('/auth/health'), {
      ...baseEnv,
      SUPABASE_URL: '',
      SUPABASE_SERVICE_KEY: '',
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.supabase_status).toBe('not_configured');
    expect(mockProbeConnection).not.toHaveBeenCalled();
  });

  it('sanitizes global 500 responses while logging details', async () => {
    mockMetadataDiscovery.mockImplementation(() => {
      throw new Error(RAW_THROWN_ERROR);
    });

    const response = await app.fetch(makeRequest('/.well-known/oauth-authorization-server'), baseEnv);
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'server_error',
      error_description: 'Internal server error',
    });
    expect(text).not.toContain(RAW_THROWN_ERROR);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Auth worker error:', expect.any(Error));
  });
});
