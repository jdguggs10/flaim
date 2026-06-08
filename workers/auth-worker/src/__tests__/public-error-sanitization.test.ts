import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../index-hono';

const RAW_SUPABASE_ERROR = 'raw Supabase password=secret failed';
const RAW_THROWN_ERROR = 'raw OAuth secret stack failed';

const { mockHasCredentials, mockMetadataDiscovery } = vi.hoisted(() => ({
  mockHasCredentials: vi.fn(),
  mockMetadataDiscovery: vi.fn(),
}));

vi.mock('../supabase-storage', () => {
  return {
    EspnSupabaseStorage: {
      fromEnvironment: vi.fn().mockReturnValue({
        hasCredentials: mockHasCredentials,
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

  it('sanitizes Supabase health check failures while logging details', async () => {
    mockHasCredentials.mockRejectedValue(new Error(RAW_SUPABASE_ERROR));

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
