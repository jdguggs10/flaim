import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleAuthorize,
  handleCheckStatus,
  handleClientRegistration,
  handleCreateCode,
  handleMetadataDiscovery,
  validateOAuthToken,
} from '../oauth-handlers';
import { isValidRedirectUri } from '@flaim/worker-shared';
import { handleToken } from '../oauth-handlers';
import { OAuthStorage } from '../oauth-storage';
import type { OAuthEnv } from '../oauth-handlers';
import { createClientBoundToken, isConfidentialClientId } from '../oauth-client-auth';

const env: OAuthEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
};

const corsHeaders = {};
const cursorRedirectUri = 'cursor://anysphere.cursor-mcp/oauth/abc123/callback';

function buildRegisterRequest(body: Record<string, unknown> = {}): Request {
  return new Request('https://api.flaim.app/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      client_name: 'Test Client',
      ...body,
    }),
  });
}

async function registerConfidentialClient(body: Record<string, unknown> = {}) {
  const res = await handleClientRegistration(buildRegisterRequest({
    token_endpoint_auth_method: 'client_secret_post',
    ...body,
  }), env, corsHeaders);
  expect(res.status).toBe(201);
  return await res.json() as {
    client_id: string;
    client_secret: string;
    token_endpoint_auth_method: string;
  };
}

function buildUnsignedConfidentialClientId(): string {
  return `mcp_conf_${'a'.repeat(22)}.${'b'.repeat(43)}.${'c'.repeat(43)}`;
}

function expectRedirectLocation(response: Response): URL {
  expect(response.status).toBe(302);
  const location = response.headers.get('Location');
  expect(location).not.toBeNull();
  return new URL(location!);
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

  it('keeps public DCR clients public without a client_secret', async () => {
    const res = await handleClientRegistration(buildRegisterRequest({
      token_endpoint_auth_method: 'none',
    }), env, corsHeaders);

    expect(res.status).toBe(201);
    const body = await res.json() as {
      client_id?: string;
      client_secret?: string;
      token_endpoint_auth_method?: string;
    };

    expect(body.client_id).toMatch(/^mcp_/);
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.client_secret).toBeUndefined();
  });

  it('keeps omitted non-Perplexity DCR clients public', async () => {
    const res = await handleClientRegistration(buildRegisterRequest(), env, corsHeaders);

    expect(res.status).toBe(201);
    const body = await res.json() as {
      client_id?: string;
      client_secret?: string;
      token_endpoint_auth_method?: string;
    };

    expect(body.client_id).toMatch(/^mcp_/);
    expect(body.client_id).not.toMatch(/^mcp_conf_/);
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.client_secret).toBeUndefined();
  });

  it('does not infer Perplexity confidential mode from client_name alone', async () => {
    const res = await handleClientRegistration(buildRegisterRequest({
      client_name: 'Perplexity',
    }), env, corsHeaders);

    expect(res.status).toBe(201);
    const body = await res.json() as {
      client_id?: string;
      client_secret?: string;
      token_endpoint_auth_method?: string;
    };

    expect(body.client_id).toMatch(/^mcp_/);
    expect(body.client_id).not.toMatch(/^mcp_conf_/);
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.client_secret).toBeUndefined();
  });

  it('returns a real client_secret for explicit client_secret_post DCR clients', async () => {
    const body = await registerConfidentialClient();

    expect(body.client_id).toMatch(/^mcp_conf_/);
    expect(isConfidentialClientId(body.client_id)).toBe(true);
    expect(body.client_secret).toMatch(/^mcp_secret_/);
    expect(body.token_endpoint_auth_method).toBe('client_secret_post');
  });

  it('returns a client_secret for Perplexity DCR even when auth method is none', async () => {
    const res = await handleClientRegistration(buildRegisterRequest({
      redirect_uris: ['https://www.perplexity.ai/rest/connections/oauth_callback'],
      client_name: 'Perplexity',
      token_endpoint_auth_method: 'none',
    }), env, corsHeaders);

    expect(res.status).toBe(201);
    const body = await res.json() as {
      client_id?: string;
      client_secret?: string;
      token_endpoint_auth_method?: string;
    };

    expect(body.client_id).toMatch(/^mcp_conf_/);
    expect(body.client_secret).toMatch(/^mcp_secret_/);
    expect(body.token_endpoint_auth_method).toBe('client_secret_post');
  });

  it('returns a client_secret for Perplexity DCR when auth method is omitted', async () => {
    const res = await handleClientRegistration(buildRegisterRequest({
      redirect_uris: ['https://www.perplexity.ai/rest/connections/oauth_callback'],
      client_name: 'Perplexity',
    }), env, corsHeaders);

    expect(res.status).toBe(201);
    const body = await res.json() as {
      client_id?: string;
      client_secret?: string;
      token_endpoint_auth_method?: string;
    };

    expect(body.client_id).toMatch(/^mcp_conf_/);
    expect(body.client_secret).toMatch(/^mcp_secret_/);
    expect(body.token_endpoint_auth_method).toBe('client_secret_post');
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
      'verifier',
      undefined
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

  it('redirects cursor:// client with error query on unsupported response_type', async () => {
    const req = new Request(
      `https://api.flaim.app/authorize?response_type=token&client_id=test` +
      `&redirect_uri=${encodeURIComponent(cursorRedirectUri)}` +
      `&code_challenge=abc123&code_challenge_method=S256`
    );
    const res = await handleAuthorize(req, env);

    const redirect = expectRedirectLocation(res);
    expect(redirect.protocol).toBe('cursor:');
    expect(redirect.hostname).toBe('anysphere.cursor-mcp');
    expect(redirect.pathname).toBe('/oauth/abc123/callback');
    expect(redirect.searchParams.get('error')).toBe('unsupported_response_type');
    expect(redirect.searchParams.get('error_description')).toBe('Only code response type is supported');
  });

  it('redirects cursor:// client with error query on missing PKCE', async () => {
    const req = new Request(
      `https://api.flaim.app/authorize?response_type=code&client_id=test` +
      `&redirect_uri=${encodeURIComponent(cursorRedirectUri)}`
    );
    const res = await handleAuthorize(req, env);

    const redirect = expectRedirectLocation(res);
    expect(redirect.protocol).toBe('cursor:');
    expect(redirect.hostname).toBe('anysphere.cursor-mcp');
    expect(redirect.pathname).toBe('/oauth/abc123/callback');
    expect(redirect.searchParams.get('error')).toBe('invalid_request');
    expect(redirect.searchParams.get('error_description')).toBe('code_challenge is required (PKCE)');
  });

  it('redirects cursor:// client with error query on non-S256 PKCE method', async () => {
    const req = new Request(
      `https://api.flaim.app/authorize?response_type=code&client_id=test` +
      `&redirect_uri=${encodeURIComponent(cursorRedirectUri)}` +
      `&code_challenge=abc123&code_challenge_method=plain`
    );
    const res = await handleAuthorize(req, env);

    const redirect = expectRedirectLocation(res);
    expect(redirect.protocol).toBe('cursor:');
    expect(redirect.hostname).toBe('anysphere.cursor-mcp');
    expect(redirect.pathname).toBe('/oauth/abc123/callback');
    expect(redirect.searchParams.get('error')).toBe('invalid_request');
    expect(redirect.searchParams.get('error_description')).toBe('Only S256 PKCE is supported');
  });

  it('passes confidential client_id through /oauth/code into authorization-code storage', async () => {
    const client = await registerConfidentialClient();
    const createAuthorizationCode = vi.fn().mockResolvedValue('auth-code');
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      createAuthorizationCode,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/oauth/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        redirect_uri: 'https://www.perplexity.ai/rest/connections/oauth_callback',
        scope: 'mcp:read',
        client_id: client.client_id,
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
      }),
    });

    const res = await handleCreateCode(req, env, 'user_123', corsHeaders);
    const body = await res.json() as { success?: boolean; code?: string };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.code).toBe('auth-code');
    expect(createAuthorizationCode).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_123',
      redirectUri: 'https://www.perplexity.ai/rest/connections/oauth_callback',
      clientId: client.client_id,
      scope: 'mcp:read',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
    }));
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

  it('ignores client_secret on public authorization_code exchange', async () => {
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
        code: 'public-code',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: 'verifier',
        client_id: 'mcp_public-client',
        client_secret: 'ignored-public-secret',
      }),
    });

    const res = await handleToken(req, env, corsHeaders);

    expect(res.status).toBe(200);
    expect(exchangeCodeForToken).toHaveBeenCalledWith(
      'public-code',
      'https://claude.ai/api/mcp/auth_callback',
      'verifier',
      undefined
    );
  });

  it('accepts authorization_code exchange for valid confidential client_secret', async () => {
    const client = await registerConfidentialClient();
    const authCode = createClientBoundToken('mcp_ac', client.client_id, 'test-code');
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
        code: authCode,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: 'verifier',
        client_id: client.client_id,
        client_secret: client.client_secret,
      }),
    });

    const res = await handleToken(req, env, corsHeaders);

    expect(res.status).toBe(200);
    expect(exchangeCodeForToken).toHaveBeenCalledWith(
      authCode,
      'https://claude.ai/api/mcp/auth_callback',
      'verifier',
      client.client_id
    );
  });

  it('accepts fallback-signed confidential clients while SUPABASE_SERVICE_KEY is unchanged', async () => {
    const client = await registerConfidentialClient();
    const authCode = createClientBoundToken('mcp_ac', client.client_id, 'test-code');
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
        code: authCode,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: 'verifier',
        client_id: client.client_id,
        client_secret: client.client_secret,
      }),
    });

    const res = await handleToken(req, env, corsHeaders);

    expect(res.status).toBe(200);
    expect(exchangeCodeForToken).toHaveBeenCalledWith(
      authCode,
      'https://claude.ai/api/mcp/auth_callback',
      'verifier',
      client.client_id
    );
  });

  it('rejects fallback-signed confidential clients after SUPABASE_SERVICE_KEY rotation', async () => {
    const client = await registerConfidentialClient();
    const authCode = createClientBoundToken('mcp_ac', client.client_id, 'test-code');
    const exchangeCodeForToken = vi.fn();
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      exchangeCodeForToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: 'verifier',
        client_id: client.client_id,
        client_secret: client.client_secret,
      }),
    });

    const res = await handleToken(req, {
      ...env,
      SUPABASE_SERVICE_KEY: 'rotated-test-key',
    }, corsHeaders);
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid_client');
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('rejects authorization_code exchange for missing confidential client_secret', async () => {
    const client = await registerConfidentialClient();
    const authCode = createClientBoundToken('mcp_ac', client.client_id, 'test-code');
    const exchangeCodeForToken = vi.fn();
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      exchangeCodeForToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: 'verifier',
        client_id: client.client_id,
      }),
    });

    const res = await handleToken(req, env, corsHeaders);
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid_client');
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('rejects authorization_code exchange for invalid confidential client_secret', async () => {
    const client = await registerConfidentialClient();
    const authCode = createClientBoundToken('mcp_ac', client.client_id, 'test-code');
    const exchangeCodeForToken = vi.fn();
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      exchangeCodeForToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: 'verifier',
        client_id: client.client_id,
        client_secret: 'wrong-secret',
      }),
    });

    const res = await handleToken(req, env, corsHeaders);
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid_client');
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('rejects authorization_code exchange when bound client_id does not match', async () => {
    const client = await registerConfidentialClient();
    const otherClient = await registerConfidentialClient();
    const authCode = createClientBoundToken('mcp_ac', client.client_id, 'test-code');
    const exchangeCodeForToken = vi.fn();
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      exchangeCodeForToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: 'verifier',
        client_id: otherClient.client_id,
        client_secret: otherClient.client_secret,
      }),
    });

    const res = await handleToken(req, env, corsHeaders);
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid_client');
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('rejects confidential client credentials for an unbound public authorization code', async () => {
    const client = await registerConfidentialClient();
    const exchangeCodeForToken = vi.fn();
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      exchangeCodeForToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: 'public-code',
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: 'verifier',
        client_id: client.client_id,
        client_secret: client.client_secret,
      }),
    });

    const res = await handleToken(req, env, corsHeaders);
    const body = await res.json() as { error?: string; error_description?: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid_client');
    expect(body.error_description).toBe('confidential clients must use client-bound authorization codes');
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('rejects unsigned confidential client_id values', async () => {
    const fakeClientId = buildUnsignedConfidentialClientId();
    const authCode = createClientBoundToken('mcp_ac', fakeClientId, 'test-code');
    const exchangeCodeForToken = vi.fn();
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      exchangeCodeForToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
        code_verifier: 'verifier',
        client_id: fakeClientId,
        client_secret: 'mcp_secret_fake',
      }),
    });

    const res = await handleToken(req, env, corsHeaders);
    const body = await res.json() as { error?: string };

    expect(isConfidentialClientId(fakeClientId)).toBe(true);
    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid_client');
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('accepts refresh_token grant for valid confidential client_secret', async () => {
    const client = await registerConfidentialClient();
    const refreshToken = createClientBoundToken('mcp_rt', client.client_id, 'refresh-token');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const refreshAccessToken = vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      scope: 'mcp:read',
      expiresAt,
      refreshToken: 'new-refresh-token',
    });
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      refreshAccessToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: client.client_id,
        client_secret: client.client_secret,
      }),
    });

    const res = await handleToken(req, env, corsHeaders);

    expect(res.status).toBe(200);
    expect(refreshAccessToken).toHaveBeenCalledWith(refreshToken, client.client_id);
  });

  it('rejects refresh_token grant for invalid confidential client_secret', async () => {
    const client = await registerConfidentialClient();
    const refreshToken = createClientBoundToken('mcp_rt', client.client_id, 'refresh-token');
    const refreshAccessToken = vi.fn();
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      refreshAccessToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: client.client_id,
        client_secret: 'wrong-secret',
      }),
    });

    const res = await handleToken(req, env, corsHeaders);
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid_client');
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('rejects refresh_token grant when bound client_id does not match', async () => {
    const client = await registerConfidentialClient();
    const otherClient = await registerConfidentialClient();
    const refreshToken = createClientBoundToken('mcp_rt', client.client_id, 'refresh-token');
    const refreshAccessToken = vi.fn();
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      refreshAccessToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: otherClient.client_id,
        client_secret: otherClient.client_secret,
      }),
    });

    const res = await handleToken(req, env, corsHeaders);
    const body = await res.json() as { error?: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid_client');
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('rejects confidential client credentials for an unbound public refresh token', async () => {
    const client = await registerConfidentialClient();
    const refreshAccessToken = vi.fn();
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      refreshAccessToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: 'public-refresh-token',
        client_id: client.client_id,
        client_secret: client.client_secret,
      }),
    });

    const res = await handleToken(req, env, corsHeaders);
    const body = await res.json() as { error?: string; error_description?: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid_client');
    expect(body.error_description).toBe('confidential clients must use client-bound refresh tokens');
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('keeps public refresh_token grant usable without client_secret', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const refreshAccessToken = vi.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      scope: 'mcp:read',
      expiresAt,
      refreshToken: 'new-refresh-token',
    });
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      refreshAccessToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: 'public-refresh-token',
      }),
    });

    const res = await handleToken(req, env, corsHeaders);

    expect(res.status).toBe(200);
    expect(refreshAccessToken).toHaveBeenCalledWith('public-refresh-token', undefined);
  });

  it('returns invalid_grant when refresh token is expired', async () => {
    const refreshAccessToken = vi.fn().mockResolvedValue(null);
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      refreshAccessToken,
    } as unknown as OAuthStorage);

    const req = new Request('https://api.flaim.app/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: 'expired-refresh-token',
      }),
    });

    const res = await handleToken(req, env, corsHeaders);
    expect(res.status).toBe(400);

    const body = await res.json() as { error?: string; error_description?: string };
    expect(body.error).toBe('invalid_grant');
    expect(body.error_description).toBe('Invalid or expired refresh token');
    expect(refreshAccessToken).toHaveBeenCalledWith('expired-refresh-token', undefined);
  });

  it('reports active connection when access token expired but refresh token is still valid', async () => {
    const getRefreshableUserTokens = vi.fn().mockResolvedValue([
      {
        id: 'token-id',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
        refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        scope: 'mcp:read',
        clientName: 'Perplexity',
      },
    ]);
    vi.spyOn(OAuthStorage, 'fromEnvironment').mockReturnValue({
      getRefreshableUserTokens,
    } as unknown as OAuthStorage);

    const res = await handleCheckStatus(env, 'user_123', corsHeaders);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      hasConnection?: boolean;
      connections?: Array<Record<string, unknown> & { clientName?: string }>;
    };
    expect(body.hasConnection).toBe(true);
    expect(body.connections).toHaveLength(1);
    expect(body.connections?.[0].clientName).toBe('Perplexity');
    expect(body.connections?.[0]).not.toHaveProperty('refreshTokenExpiresAt');
    expect(getRefreshableUserTokens).toHaveBeenCalledWith('user_123');
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

  it('accepts ChatGPT connector OAuth callback with any app ID', () => {
    expect(isValidRedirectUri('https://chatgpt.com/connector/oauth/pV6dW4LxKl3M')).toBe(true);
    expect(isValidRedirectUri('https://chatgpt.com/connector/oauth/fQYjWb9wMu_y')).toBe(true);
  });

  it('rejects ChatGPT connector URI with query string or fragment', () => {
    expect(isValidRedirectUri('https://chatgpt.com/connector/oauth/abc?evil=true')).toBe(false);
    expect(isValidRedirectUri('https://chatgpt.com/connector/oauth/abc#frag')).toBe(false);
  });

  it('rejects non-chatgpt.com host using connector path', () => {
    expect(isValidRedirectUri('https://evil.com/connector/oauth/abc')).toBe(false);
  });

  it('accepts Perplexity custom connector callback on any subdomain/TLD', () => {
    expect(isValidRedirectUri('https://www.perplexity.ai/rest/connections/oauth_callback')).toBe(true);
    expect(isValidRedirectUri('https://www.perplexity.com/rest/connections/oauth_callback')).toBe(true);
    expect(isValidRedirectUri('https://enterprise.perplexity.ai/rest/connections/oauth_callback')).toBe(true);
    expect(isValidRedirectUri('https://perplexity.ai/rest/connections/oauth_callback')).toBe(true);
  });

  it('rejects non-perplexity host using perplexity callback path', () => {
    expect(isValidRedirectUri('https://evil-perplexity.ai/rest/connections/oauth_callback')).toBe(false);
    expect(isValidRedirectUri('https://evil.com/rest/connections/oauth_callback')).toBe(false);
  });

  it('accepts Gemini CLI loopback with /oauth2callback path', () => {
    expect(isValidRedirectUri('http://127.0.0.1:9876/oauth2callback')).toBe(true);
    expect(isValidRedirectUri('http://localhost:9876/oauth2callback')).toBe(true);
  });

  it('accepts Windsurf loopback callback', () => {
    expect(isValidRedirectUri('http://127.0.0.1:5555/windsurf-auth-callback')).toBe(true);
  });

  it('accepts VS Code fixed-port callback', () => {
    expect(isValidRedirectUri('http://127.0.0.1:33418')).toBe(true);
  });

  it('accepts VS Code web redirect', () => {
    expect(isValidRedirectUri('https://vscode.dev/redirect')).toBe(true);
  });

  it('accepts Cursor custom URI scheme', () => {
    expect(isValidRedirectUri('cursor://anysphere.cursor-mcp/oauth/abc123/callback')).toBe(true);
    expect(isValidRedirectUri('cursor://anysphere.cursor-retrieval/oauth/xyz/callback')).toBe(true);
  });

  it('rejects Cursor URI with query string or fragment', () => {
    expect(isValidRedirectUri('cursor://anysphere.cursor-mcp/oauth/abc/callback?evil=true')).toBe(false);
    expect(isValidRedirectUri('cursor://anysphere.cursor-mcp/oauth/abc/callback#frag')).toBe(false);
  });

  it('rejects non-Cursor custom URI scheme', () => {
    expect(isValidRedirectUri('evil://anysphere.cursor-mcp/oauth/abc/callback')).toBe(false);
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
