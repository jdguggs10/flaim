import { describe, expect, it } from 'vitest';
import app from '../index-hono';

// auth-worker owns /.well-known/* on the api.flaim.app custom domain (see
// wrangler.jsonc routes), so these handlers — not fantasy-mcp's own copy —
// serve production's real `/.well-known/oauth-protected-resource`. FLA-281:
// preview's auth-worker and gateway are separate workers.dev hosts, so
// `resource` (the gateway) and `authorization_servers` (this worker) must
// diverge on the preview lane instead of both defaulting to api.flaim.app.

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-service-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
  TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CREDENTIALS_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

function makeRequest(path: string): Request {
  return new Request(`https://api.flaim.app${path}`);
}

describe('/.well-known/oauth-protected-resource (auth-worker)', () => {
  it('advertises production for both resource and authorization_servers by default', async () => {
    const response = await app.fetch(makeRequest('/.well-known/oauth-protected-resource'), {
      ...baseEnv,
      ENVIRONMENT: 'prod',
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe('https://api.flaim.app/mcp');
    expect(body.authorization_servers).toEqual(['https://api.flaim.app']);
  });

  it('advertises the preview gateway as resource and this worker as the authorization server on preview (FLA-281)', async () => {
    const response = await app.fetch(makeRequest('/.well-known/oauth-protected-resource'), {
      ...baseEnv,
      ENVIRONMENT: 'preview',
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe('https://fantasy-mcp-preview.gerrygugger.workers.dev/mcp');
    expect(body.authorization_servers).toEqual(['https://auth-worker-preview.gerrygugger.workers.dev']);
  });

  it('applies the same environment-aware split to the resource-suffixed alias route', async () => {
    const prodResponse = await app.fetch(
      makeRequest('/.well-known/oauth-protected-resource/fantasy/mcp'),
      { ...baseEnv, ENVIRONMENT: 'prod' }
    );
    const prodBody = await prodResponse.json() as { resource: string; authorization_servers: string[] };
    expect(prodBody.resource).toBe('https://api.flaim.app/fantasy/mcp');
    expect(prodBody.authorization_servers).toEqual(['https://api.flaim.app']);

    const previewResponse = await app.fetch(
      makeRequest('/.well-known/oauth-protected-resource/fantasy/mcp'),
      { ...baseEnv, ENVIRONMENT: 'preview' }
    );
    const previewBody = await previewResponse.json() as { resource: string; authorization_servers: string[] };
    expect(previewBody.resource).toBe('https://fantasy-mcp-preview.gerrygugger.workers.dev/fantasy/mcp');
    expect(previewBody.authorization_servers).toEqual(['https://auth-worker-preview.gerrygugger.workers.dev']);
  });
});
