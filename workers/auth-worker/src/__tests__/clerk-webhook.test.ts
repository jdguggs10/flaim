import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockRpc }),
}));

import {
  decodeSvixSigningSecret,
  verifyClerkWebhookSignature,
  type SvixHeaders,
} from '../clerk-webhook';
import worker, { type Env } from '../index-hono';

const TEST_SECRET = 'whsec_' + btoa('test-signing-secret-bytes');

async function signSvixTestPayload(secret: string, svixId: string, svixTimestamp: string, body: string) {
  const secretBytes = Uint8Array.from(atob(secret.replace('whsec_', '')), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${svixId}.${svixTimestamp}.${body}`));
  const bytes = new Uint8Array(sig);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `v1,${btoa(binary)}`;
}

function rpcResult(result: { data: unknown; error: unknown } | 'abort') {
  mockRpc.mockReturnValue({
    abortSignal: (signal: AbortSignal) =>
      new Promise((resolve, reject) => {
        if (result === 'abort') {
          if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          return;
        }
        resolve(result);
      }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('decodeSvixSigningSecret', () => {
  it('decodes a whsec_-prefixed base64 secret into raw bytes', () => {
    const bytes = decodeSvixSigningSecret(TEST_SECRET);
    expect(new TextDecoder().decode(bytes)).toBe('test-signing-secret-bytes');
  });

  it('throws on a secret missing the whsec_ prefix', () => {
    expect(() => decodeSvixSigningSecret('not-a-valid-secret')).toThrow();
  });
});

describe('verifyClerkWebhookSignature', () => {
  const svixId = 'msg_test123';
  const body = JSON.stringify({ type: 'user.deleted', data: { id: 'user_abc' } });

  async function buildFreshHeaders(overrides?: Partial<SvixHeaders>): Promise<SvixHeaders> {
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const svixSignature = await signSvixTestPayload(TEST_SECRET, svixId, svixTimestamp, body);
    return { svixId, svixTimestamp, svixSignature, ...overrides };
  }

  it('accepts a valid signature with a fresh timestamp', async () => {
    const headers = await buildFreshHeaders();
    const secretBytes = decodeSvixSigningSecret(TEST_SECRET);
    await expect(verifyClerkWebhookSignature(body, headers, secretBytes)).resolves.toBe(true);
  });

  it('rejects a timestamp 6 minutes in the past', async () => {
    const svixTimestamp = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const svixSignature = await signSvixTestPayload(TEST_SECRET, svixId, svixTimestamp, body);
    const headers: SvixHeaders = { svixId, svixTimestamp, svixSignature };
    const secretBytes = decodeSvixSigningSecret(TEST_SECRET);
    await expect(verifyClerkWebhookSignature(body, headers, secretBytes)).resolves.toBe(false);
  });

  it('rejects a timestamp 6 minutes in the future', async () => {
    const svixTimestamp = String(Math.floor(Date.now() / 1000) + 6 * 60);
    const svixSignature = await signSvixTestPayload(TEST_SECRET, svixId, svixTimestamp, body);
    const headers: SvixHeaders = { svixId, svixTimestamp, svixSignature };
    const secretBytes = decodeSvixSigningSecret(TEST_SECRET);
    await expect(verifyClerkWebhookSignature(body, headers, secretBytes)).resolves.toBe(false);
  });

  it('rejects a tampered body signed under a different payload', async () => {
    const headers = await buildFreshHeaders();
    const secretBytes = decodeSvixSigningSecret(TEST_SECRET);
    const tamperedBody = JSON.stringify({ type: 'user.deleted', data: { id: 'user_evil' } });
    await expect(verifyClerkWebhookSignature(tamperedBody, headers, secretBytes)).resolves.toBe(false);
  });

  it('rejects a svix-signature header with only a v2 scheme', async () => {
    const headers = await buildFreshHeaders({ svixSignature: 'v2,somebase64value' });
    const secretBytes = decodeSvixSigningSecret(TEST_SECRET);
    await expect(verifyClerkWebhookSignature(body, headers, secretBytes)).resolves.toBe(false);
  });

  it('rejects garbage base64 in the v1 slot without throwing', async () => {
    const headers = await buildFreshHeaders({ svixSignature: 'v1,not!!valid==base64%%' });
    const secretBytes = decodeSvixSigningSecret(TEST_SECRET);
    await expect(verifyClerkWebhookSignature(body, headers, secretBytes)).resolves.toBe(false);
  });

  it('accepts a valid signature when only the second of multiple candidates matches', async () => {
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const validSignature = await signSvixTestPayload(TEST_SECRET, svixId, svixTimestamp, body);
    const headers: SvixHeaders = {
      svixId,
      svixTimestamp,
      svixSignature: `v1,bm90LXZhbGlk ${validSignature}`,
    };
    const secretBytes = decodeSvixSigningSecret(TEST_SECRET);
    await expect(verifyClerkWebhookSignature(body, headers, secretBytes)).resolves.toBe(true);
  });
});

describe('POST /webhooks/clerk/account-deletion', () => {
  const baseEnv = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_KEY: 'test-key',
    NODE_ENV: 'test',
    ENVIRONMENT: 'test',
    ESPN_HISTORY_REFRESH: { create: vi.fn() },
    TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
    CREDENTIALS_RATE_LIMITER: { limit: async () => ({ success: true }) },
    WEBHOOK_RATE_LIMITER: { limit: async () => ({ success: true }) },
  } as unknown as Env;

  async function makeSignedRequest(
    body: string,
    options?: { secret?: string; tamperSignature?: boolean }
  ): Promise<Request> {
    const secret = options?.secret ?? TEST_SECRET;
    const svixId = 'msg_test123';
    const svixTimestamp = String(Math.floor(Date.now() / 1000));
    const svixSignature = options?.tamperSignature
      ? 'v1,dGFtcGVyZWQ='
      : await signSvixTestPayload(secret, svixId, svixTimestamp, body);
    return new Request('https://auth.example.com/auth/webhooks/clerk/account-deletion', {
      method: 'POST',
      headers: {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      },
      body,
    });
  }

  it('returns 500 when the signing secret is not configured', async () => {
    const body = JSON.stringify({ type: 'user.deleted', data: { id: 'user_abc' } });
    const request = await makeSignedRequest(body);
    const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: undefined };

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(500);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 when Svix headers are missing', async () => {
    const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET };
    const request = new Request('https://auth.example.com/auth/webhooks/clerk/account-deletion', {
      method: 'POST',
      body: JSON.stringify({ type: 'user.deleted', data: { id: 'user_abc' } }),
    });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 when the signature is invalid', async () => {
    const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET };
    const body = JSON.stringify({ type: 'user.deleted', data: { id: 'user_abc' } });
    const request = await makeSignedRequest(body, { tamperSignature: true });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 200 skip for a verified non-deletion event', async () => {
    const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET };
    const body = JSON.stringify({ type: 'user.updated', data: { id: 'user_abc' } });
    const request = await makeSignedRequest(body);

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, skipped: true });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 200 skip when data.id is missing', async () => {
    const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET };
    const body = JSON.stringify({ type: 'user.deleted', data: {} });
    const request = await makeSignedRequest(body);

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, skipped: true });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 200 skip for a correctly signed body of literally "null"', async () => {
    const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET };
    const body = 'null';
    const request = await makeSignedRequest(body);

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, skipped: true });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 200 skip for a correctly signed JSON array body', async () => {
    const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET };
    const body = JSON.stringify(['user.deleted', { id: 'user_abc' }]);
    const request = await makeSignedRequest(body);

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, skipped: true });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('purges and returns 200 on a valid user.deleted event', async () => {
    rpcResult({ data: null, error: null });
    const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET };
    const body = JSON.stringify({ type: 'user.deleted', data: { id: 'user_abc' } });
    const request = await makeSignedRequest(body);

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, deleted: true });
    expect(mockRpc).toHaveBeenCalledWith('purge_account_data', { p_clerk_user_id: 'user_abc' });
  });

  it('returns 500 when the purge RPC errors', async () => {
    rpcResult({ data: null, error: { message: 'db error' } });
    const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET };
    const body = JSON.stringify({ type: 'user.deleted', data: { id: 'user_abc' } });
    const request = await makeSignedRequest(body);

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(500);
  });

  it('returns 504 when the purge RPC times out', async () => {
    rpcResult('abort');
    const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET };
    const body = JSON.stringify({ type: 'user.deleted', data: { id: 'user_abc' } });
    const request = await makeSignedRequest(body);

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(504);
  }, 10000);

  it('returns 429 and never invokes the handler when rate limited', async () => {
    const env = {
      ...baseEnv,
      CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET,
      WEBHOOK_RATE_LIMITER: { limit: async () => ({ success: false }) },
    };
    const body = JSON.stringify({ type: 'user.deleted', data: { id: 'user_abc' } });
    const request = await makeSignedRequest(body);

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(429);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  describe('request body size limits', () => {
    const svixId = 'msg_test123';

    it('returns 413 when Content-Length declares a body over the cap', async () => {
      const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET };
      const body = JSON.stringify({ type: 'user.deleted', data: { id: 'user_abc' } });
      const svixTimestamp = String(Math.floor(Date.now() / 1000));
      const svixSignature = await signSvixTestPayload(TEST_SECRET, svixId, svixTimestamp, body);
      // Declares 200 KB even though the actual body sent below is tiny --
      // this must be rejected on the header alone, before the body is read.
      const request = new Request('https://auth.example.com/auth/webhooks/clerk/account-deletion', {
        method: 'POST',
        headers: {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
          'content-length': String(200 * 1024),
        },
        body,
      });

      const response = await worker.fetch(request, env);

      expect(response.status).toBe(413);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('returns 413 when a chunked body streams past the cap with no Content-Length', async () => {
      const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET };
      const svixTimestamp = String(Math.floor(Date.now() / 1000));
      const chunk = new Uint8Array(20 * 1024).fill(97); // 20 KB per chunk
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < 4; i++) controller.enqueue(chunk); // 80 KB total, well over the 64 KB cap
          controller.close();
        },
      });
      // No Content-Length header at all -- the cap must be enforced while
      // reading the stream, not just by trusting a declared header.
      const request = new Request('https://auth.example.com/auth/webhooks/clerk/account-deletion', {
        method: 'POST',
        headers: {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': 'v1,irrelevant-because-oversized',
        },
        body: stream,
      });

      const response = await worker.fetch(request, env);

      expect(response.status).toBe(413);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('still verifies and succeeds for a normal-size valid request', async () => {
      rpcResult({ data: null, error: null });
      const env = { ...baseEnv, CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET: TEST_SECRET };
      const body = JSON.stringify({ type: 'user.deleted', data: { id: 'user_normal_size' } });
      const request = await makeSignedRequest(body);

      const response = await worker.fetch(request, env);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ received: true, deleted: true });
      expect(mockRpc).toHaveBeenCalledWith('purge_account_data', { p_clerk_user_id: 'user_normal_size' });
    });
  });
});
