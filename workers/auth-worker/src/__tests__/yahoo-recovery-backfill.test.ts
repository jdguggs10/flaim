import { describe, expect, it, vi } from 'vitest';
import { YAHOO_APP_REVIEW_OUTAGE_MESSAGE } from '@flaim/worker-shared';
import {
  YAHOO_RECOVERY_CUTOFF,
  YAHOO_RECOVERY_EXPIRES_AT,
  parseYahooRecoveryRequest,
  runYahooRecovery,
  sanitizeYahooRecoveryProviderResult,
} from '../yahoo-recovery-backfill';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
};

const candidate = {
  userId: 'user_123456789abcdef',
  createdAt: '2026-08-01T00:00:00.000Z',
  leagueRows: 0,
  sync: {
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorCode: null,
  },
};

function request(body?: string): Request {
  return new Request('https://auth.example.com/internal/backfill/yahoo-recovery', {
    method: 'POST',
    ...(body === undefined ? {} : { body }),
  });
}

describe('parseYahooRecoveryRequest', () => {
  it('defaults to a first-page dry run', async () => {
    await expect(parseYahooRecoveryRequest(request())).resolves.toEqual({
      request: { dryRun: true, cursor: null },
    });
  });

  it('requires explicit boolean apply and a valid opaque cursor', async () => {
    const parsed = await parseYahooRecoveryRequest(request('{"dryRun":false,"cursor":"dXNlcl8x"}'));
    expect(parsed.request).toEqual({ dryRun: false, cursor: 'dXNlcl8x' });

    const malformed = await parseYahooRecoveryRequest(request('{"dryRun":false,"cursor":"***"}'));
    expect(malformed.error?.body.error).toBe('invalid_cursor');
  });

  it('rejects malformed JSON and unknown fields', async () => {
    expect((await parseYahooRecoveryRequest(request('{bad'))).error?.body.error).toBe('invalid_request');
    expect((await parseYahooRecoveryRequest(request('{"apply":true}'))).error?.body.error).toBe('invalid_request');
  });
});

describe('runYahooRecovery', () => {
  it('dry-runs without calling the provider and returns only a masked user id', async () => {
    const refresh = vi.fn();
    const storage = {
      page: vi.fn().mockResolvedValue({ eligibleUsers: 13, candidate, hasMore: true }),
    };

    const result = await runYahooRecovery(env, { dryRun: true, cursor: null }, { storage, refresh });

    expect(storage.page).toHaveBeenCalledWith(YAHOO_RECOVERY_CUTOFF, null, true);
    expect(refresh).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: 'dry_run',
      eligibleUsers: 13,
      candidate: { userIdMasked: 'user_123...' },
    });
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(result)).not.toContain(candidate.userId);
  });

  it('uses the returned keyset cursor to select the next stable user', async () => {
    const firstStorage = { page: vi.fn().mockResolvedValue({ candidate, hasMore: true }) };
    const first = await runYahooRecovery(env, { dryRun: true, cursor: null }, { storage: firstStorage });
    const secondStorage = { page: vi.fn().mockResolvedValue({ candidate: null, hasMore: false }) };

    await runYahooRecovery(env, { dryRun: true, cursor: first.nextCursor }, { storage: secondStorage });

    expect(secondStorage.page).toHaveBeenCalledWith(YAHOO_RECOVERY_CUTOFF, candidate.userId, false);
  });

  it('applies exactly one Yahoo refresh through the scheduled sync path', async () => {
    const storage = { page: vi.fn().mockResolvedValue({ candidate, hasMore: false }) };
    const refresh = vi.fn().mockResolvedValue({
      success: true,
      requestedPlatforms: ['yahoo'],
      results: {
        yahoo: { platform: 'yahoo', status: 'success', httpStatus: 200, details: { count: 4 } },
      },
    });

    const result = await runYahooRecovery(env, { dryRun: false, cursor: null }, { storage, refresh });

    expect(storage.page).toHaveBeenCalledWith(YAHOO_RECOVERY_CUTOFF, null, false);
    expect(refresh).toHaveBeenCalledWith(env, candidate.userId, ['yahoo'], {}, expect.any(String), 'scheduled');
    expect(result).toMatchObject({
      outcome: 'processed',
      nextCursor: null,
      provider: { status: 'success', leagueCount: 4, stopReason: null },
    });
  });

  it('expires before reading storage or calling Yahoo', async () => {
    const storage = { page: vi.fn() };
    const refresh = vi.fn();

    const result = await runYahooRecovery(
      env,
      { dryRun: false, cursor: null },
      { storage, refresh, now: () => Date.parse(YAHOO_RECOVERY_EXPIRES_AT) }
    );

    expect(result.outcome).toBe('expired');
    expect(storage.page).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('sanitizeYahooRecoveryProviderResult', () => {
  it('stops on the exact app-level Yahoo denial', () => {
    const result = sanitizeYahooRecoveryProviderResult({
      platform: 'yahoo',
      status: 'error',
      httpStatus: 502,
      error: 'yahoo_api_error',
      error_description: YAHOO_APP_REVIEW_OUTAGE_MESSAGE.discovery,
      details: { upstream_status: 403 },
    });
    expect(result.stopReason).toBe('provider_denied');
  });

  it('does not stop the fleet for a generic resource-level 403 or local cooldown', () => {
    const denied = sanitizeYahooRecoveryProviderResult({
      platform: 'yahoo', status: 'error', httpStatus: 502, error: 'yahoo_api_error',
      error_description: 'Yahoo API returned 403', details: { upstream_status: 403 },
    });
    const cooldown = sanitizeYahooRecoveryProviderResult({
      platform: 'yahoo', status: 'error', httpStatus: 429, error: 'refresh_cooldown', retryAfter: '75',
    });
    expect(denied.stopReason).toBeNull();
    expect(cooldown).toMatchObject({ stopReason: null, retryAfterSeconds: 75 });
  });

  it('stops on upstream 429/999 while preserving retry metadata', () => {
    const result = sanitizeYahooRecoveryProviderResult({
      platform: 'yahoo', status: 'error', httpStatus: 503,
      error: 'yahoo_api_temporarily_unavailable', retryAfter: '300',
      details: { upstream_status: 999, retryable: true },
    });
    expect(result).toMatchObject({
      stopReason: 'rate_limited', upstreamStatus: 999, retryable: true, retryAfterSeconds: 300,
    });
  });

  it('does not infer permanence from a 401 refresh failure', () => {
    const result = sanitizeYahooRecoveryProviderResult({
      platform: 'yahoo', status: 'error', httpStatus: 401, error: 'refresh_failed',
    });
    expect(result.stopReason).toBeNull();
    expect(result).not.toHaveProperty('retryable');
  });
});
