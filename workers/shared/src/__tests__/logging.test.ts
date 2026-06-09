import { afterEach, describe, expect, it, vi } from 'vitest';
import { logSetupSignal } from '../logging';

describe('logSetupSignal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the setup signal schema with allowlisted fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logSetupSignal({
      service: 'auth-worker',
      component: 'oauth-provider',
      event: 'oauth_token_failed',
      stage: 'token_exchange',
      outcome: 'failure',
      failure_kind: 'validation',
      error_code: 'invalid_grant',
      http_status: 400,
      retryable: false,
      auth_type: 'oauth',
      has_auth_header: true,
      correlation_id: 'cid_123',
      cf_ray: 'ray_123',
      request_path: '/auth/token',
      method: 'POST',
      duration_ms: 12,
      environment: 'prod',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      schema_version: 1,
      service: 'auth-worker',
      component: 'oauth-provider',
      event: 'oauth_token_failed',
      stage: 'token_exchange',
      outcome: 'failure',
      error_code: 'invalid_grant',
      http_status: 400,
      retryable: false,
      correlation_id: 'cid_123',
      request_path: '/auth/token',
      method: 'POST',
      environment: 'prod',
    });
  });

  it('drops forbidden or unknown input keys even when accidentally supplied', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logSetupSignal({
      service: 'auth-worker',
      component: 'oauth-provider',
      event: 'oauth_token_failed',
      outcome: 'failure',
      Authorization: 'Bearer clerk.jwt.secret',
      authorization: 'Bearer oauth.access.token',
      client_secret: 'client-secret',
      code_verifier: 'verifier',
      state: 'oauth-state',
      refresh_token: 'refresh-token',
      access_token: 'access-token',
      email: 'person@example.com',
      user_id: 'user_123',
      redirect_uri: 'https://client.example/callback?code=secret',
      league_id: 'raw-league-id',
      team_id: 'raw-team-id',
      request_body: { swid: '{00000000-0000-0000-0000-000000000000}' },
    } as Parameters<typeof logSetupSignal>[0]);

    const payloadText = String(spy.mock.calls[0][0]);
    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    expect(payload.Authorization).toBeUndefined();
    expect(payload.authorization).toBeUndefined();
    expect(payload.client_secret).toBeUndefined();
    expect(payload.refresh_token).toBeUndefined();
    expect(payload.email).toBeUndefined();
    expect(payload.user_id).toBeUndefined();
    expect(payload.redirect_uri).toBeUndefined();
    expect(payload.league_id).toBeUndefined();
    expect(payload.team_id).toBeUndefined();
    expect(payload.request_body).toBeUndefined();
    expect(payloadText).not.toContain('clerk.jwt.secret');
    expect(payloadText).not.toContain('refresh-token');
    expect(payloadText).not.toContain('person@example.com');
    expect(payloadText).not.toContain('raw-league-id');
  });

  it('does not throw if console logging fails', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {
      throw new Error('console unavailable');
    });

    expect(() => logSetupSignal({
      service: 'auth-worker',
      component: 'oauth-provider',
      event: 'oauth_token_failed',
      outcome: 'failure',
    })).not.toThrow();
  });
});
