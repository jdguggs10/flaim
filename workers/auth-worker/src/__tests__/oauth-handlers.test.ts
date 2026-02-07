import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAuthorize, handleClientRegistration, handleMetadataDiscovery, isValidRedirectUri, validateOAuthToken } from '../oauth-handlers';
import { handleToken } from '../oauth-handlers';
import { OAuthStorage } from '../oauth-storage';
import type { OAuthEnv } from '../oauth-handlers';

const env: OAuthEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
};

const corsHeaders = {};

function buildRegisterRequest(): Request {
  return new Request('https://api.flaim.app/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      client_name: 'Test Client',
    }),
  });
}

describe('oauth-handlers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates unique client_id values for DCR', async () => {
    const res1 = await handleClientRegistration(buildRegisterRequest(), env, corsHeaders);
    const res2 = await handleClientRegistration(buildRegisterRequest(), env, corsHeaders);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const body1 = await res1.json() as { client_id?: string };
    const body2 = await res2.json() as { client_id?: string };

    expect(body1.client_id).toMatch(/^mcp_/);
    expect(body2.client_id).toMatch(/^mcp_/);
    expect(body1.client_id).not.toBe(body2.client_id);
  });

  it('requires PKCE code_challenge for /authorize', async () => {
    const req = new Request(
      'https://api.flaim.app/authorize?response_type=code&client_id=test&redirect_uri=https://claude.ai/api/mcp/auth_callback'
    );
    const res = await handleAuthorize(req, env);

    expect(res.status).toBe(302);
    const location = res.headers.get('Location');
    expect(location).toBeTruthy();

    const redirect = new URL(location as string);
    expect(redirect.searchParams.get('error')).toBe('invalid_request');
    expect(redirect.searchParams.get('error_description')).toBe('code_challenge is required (PKCE)');
  });

  it('rejects missing redirect_uri for /authorize', async () => {
    const req = new Request('https://api.flaim.app/authorize?response_type=code');
    const res = await handleAuthorize(req, env);

    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string; error_description?: string };
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toBe('redirect_uri is required');
  });

  it('returns invalid_grant when token exchange fails', async () => {
    const exchangeCodeForToken = vi.fn().mockResolvedValue(null);
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      exchangeCodeForToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: 'test-code',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: 'verifier',
      }),
    });

    const res = await handleToken(req, env, corsHeaders);
    expect(res.status).toBe(400);

    const body = await res.json() as { error?: string; error_description?: string };
    expect(body.error).toBe('invalid_grant');
    expect(body.error_description).toContain('Invalid authorization code');
    expect(exchangeCodeForToken).toHaveBeenCalledWith(
      'test-code',
      'https://claude.ai/api/mcp/auth_callback',
      'verifier'
    );
  });

  it('rejects plain PKCE code_challenge_method', async () => {
    const req = new Request(
      'https://api.flaim.app/authorize?response_type=code&client_id=test' +
      '&redirect_uri=https://claude.ai/api/mcp/auth_callback' +
      '&code_challenge=abc123&code_challenge_method=plain'
    );
    const res = await handleAuthorize(req, env);

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('error_description')).toContain('S256');
  });

  it('uses FRONTEND_URL override for consent redirect', async () => {
    const req = new Request(
      'https://api.flaim.app/authorize?response_type=code&client_id=test' +
      '&redirect_uri=https://claude.ai/api/mcp/auth_callback' +
      '&code_challenge=abc123&code_challenge_method=S256'
    );
    const res = await handleAuthorize(req, {
      ...env,
      ENVIRONMENT: 'preview',
      FRONTEND_URL: 'https://preview.example.com/',
    });

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin).toBe('https://preview.example.com');
    expect(location.pathname).toBe('/oauth/consent');
  });

  it('authorization server metadata advertises S256 only', async () => {
    const res = handleMetadataDiscovery(env, {});
    const body = await res.json() as { code_challenge_methods_supported: string[] };
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('returns a token response for valid authorization_code exchange', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const exchangeCodeForToken = vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      scope: 'mcp:read',
      expiresAt,
      refreshToken: 'refresh-token',
    });
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      exchangeCodeForToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: 'test-code',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: 'verifier',
      }),
    });

    const res = await handleToken(req, env, corsHeaders);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      scope?: string;
      refresh_token?: string;
    };
    expect(body.access_token).toBe('access-token');
    expect(body.token_type).toBe('Bearer');
    expect(body.scope).toBe('mcp:read');
    expect(body.refresh_token).toBe('refresh-token');
    expect(typeof body.expires_in).toBe('number');
    expect(body.expires_in).toBeGreaterThan(0);
  });
});

describe('redirect URI validation', () => {
  it('rejects allowlisted URI with appended query string (startsWith exploit)', () => {
    // startsWith() currently allows this — exact match shouldn't
    expect(isValidRedirectUri('http://localhost:3000/oauth/callback?redirect=http://evil.com')).toBe(false);
  });

  it('accepts exact allowlist match', () => {
    expect(isValidRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
  });

  it('accepts loopback with valid callback path', () => {
    expect(isValidRedirectUri('http://localhost:9999/callback')).toBe(true);
    expect(isValidRedirectUri('http://127.0.0.1:9999/oauth/callback')).toBe(true);
  });

  it('rejects loopback with arbitrary path', () => {
    expect(isValidRedirectUri('http://localhost:9999/evil')).toBe(false);
  });
});

describe('validateOAuthToken resource enforcement', () => {
  it('rejects token when resource does not match', async () => {
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      validateAccessToken: vi.fn().mockResolvedValue({
        valid: true,
        userId: 'user-123',
        scope: 'mcp:read',
        resource: 'https://api.flaim.app/mcp',
      }),
    } as unknown as OAuthStorage);

    const result = await validateOAuthToken('test-token', env, 'https://wrong-resource.com/mcp');
    expect(result).toBeNull();
  });

  it('accepts token when resource matches', async () => {
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      validateAccessToken: vi.fn().mockResolvedValue({
        valid: true,
        userId: 'user-123',
        scope: 'mcp:read',
        resource: 'https://api.flaim.app/mcp',
      }),
    } as unknown as OAuthStorage);

    const result = await validateOAuthToken('test-token', env, 'https://api.flaim.app/mcp');
    expect(result).toEqual({ userId: 'user-123', scope: 'mcp:read' });
  });

  it('accepts token when no resource was stored (backwards compat)', async () => {
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      validateAccessToken: vi.fn().mockResolvedValue({
        valid: true,
        userId: 'user-123',
        scope: 'mcp:read',
        resource: null,
      }),
    } as unknown as OAuthStorage);

    const result = await validateOAuthToken('test-token', env, 'https://api.flaim.app/mcp');
    expect(result).toEqual({ userId: 'user-123', scope: 'mcp:read' });
  });
});
