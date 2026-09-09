import { describe, expect, it, vi } from 'vitest';
import { YAHOO_APP_REVIEW_OUTAGE_MESSAGE } from '@flaim/worker-shared';
import {
  YAHOO_TARGETED_RECOVERY_EXPIRES_AT,
  hashYahooTargetedRecoveryManifest,
  parseYahooTargetedRecoveryRequest,
  runYahooTargetedRecovery,
  type YahooTargetedRecoveryEnv,
  type YahooTargetedRecoveryRequest,
} from '../yahoo-targeted-recovery';

const env: YahooTargetedRecoveryEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
};

function manifest(): string[] {
  return Array.from({ length: 59 }, (_, index) => `user_${String(index).padStart(20, '0')}`);
}

async function parse(body: unknown, expected = manifest()) {
  const hash = await hashYahooTargetedRecoveryManifest(expected);
  return parseYahooTargetedRecoveryRequest(
    new Request('https://auth.example.com/internal/backfill/yahoo-recovery', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    hash
  );
}

function validRequest(dryRun = true): YahooTargetedRecoveryRequest {
  const cohort = manifest();
  return { manifest: cohort, target: cohort[5], dryRun };
}

describe('parseYahooTargetedRecoveryRequest', () => {
  it('accepts only the committed cohort and defaults to dry-run', async () => {
    const cohort = manifest().reverse();
    const result = await parse({ manifest: cohort, target: cohort[5] }, cohort);

    expect(result).toEqual({
      request: { manifest: cohort, target: cohort[5], dryRun: true },
    });
  });

  it('accepts explicit dryRun:false', async () => {
    const cohort = manifest();
    const result = await parse({ manifest: cohort, target: cohort[0], dryRun: false });

    expect('request' in result && result.request.dryRun).toBe(false);
  });

  it.each([
    ['wrong count', () => manifest().slice(1)],
    ['duplicate', () => manifest().map((id, index) => index === 1 ? manifest()[0] : id)],
    ['malformed ID', () => manifest().map((id, index) => index === 1 ? 'not-a-user' : id)],
  ])('rejects a manifest with %s', async (_label, makeManifest) => {
    const cohort = makeManifest();
    const result = await parse({ manifest: cohort, target: cohort[0] });

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_manifest' } } });
  });

  it('rejects a valid-shaped manifest whose digest does not match', async () => {
    const cohort = manifest();
    const different = [...cohort];
    different[0] = 'user_99999999999999999999';
    const result = await parse({ manifest: different, target: different[0] }, cohort);

    expect(result).toMatchObject({ error: { body: { error: 'invalid_manifest' } } });
  });

  it('rejects a target outside the committed manifest', async () => {
    const cohort = manifest();
    const result = await parse({ manifest: cohort, target: 'user_99999999999999999999' });

    expect(result).toMatchObject({ error: { body: { error: 'invalid_target' } } });
  });

  it('rejects unknown fields and non-boolean dryRun values', async () => {
    const cohort = manifest();
    const unknown = await parse({ manifest: cohort, target: cohort[0], extra: true });
    const nonBoolean = await parse({ manifest: cohort, target: cohort[0], dryRun: 'false' });

    expect(unknown).toMatchObject({ error: { body: { error: 'invalid_request' } } });
    expect(nonBoolean).toMatchObject({ error: { body: { error: 'invalid_dry_run' } } });
  });

  it('rejects a declared body larger than 8KB before parsing', async () => {
    const request = new Request('https://auth.example.com/internal/backfill/yahoo-recovery', {
      method: 'POST',
      headers: { 'Content-Length': '8193' },
      body: '{}',
    });
    const result = await parseYahooTargetedRecoveryRequest(request);

    expect(result).toMatchObject({ error: { status: 413, body: { error: 'request_too_large' } } });
  });
});

describe('runYahooTargetedRecovery', () => {
  it('returns only metadata for a dry run', async () => {
    const snapshot = vi.fn().mockResolvedValue({
      credentialsPresent: true,
      leagueRows: 2,
      sync: {
        lastAttemptAt: '2026-09-08T20:00:00.000Z',
        lastSuccessAt: null,
        lastFailureAt: '2026-09-08T20:00:01.000Z',
        lastErrorCode: 'yahoo_api_temporarily_unavailable',
        syncLeaseExpiresAt: null,
      },
    });
    const refresh = vi.fn();

    const result = await runYahooTargetedRecovery(env, validRequest(), {
      now: () => Date.parse('2026-09-08T21:00:00.000Z'),
      snapshot,
      refresh,
    });

    expect(result).toMatchObject({
      outcome: 'dry_run', dryRun: true, targetIndex: 5,
      snapshot: { credentialsPresent: true, leagueRows: 2 },
    });
    expect(snapshot).toHaveBeenCalledWith(env, validRequest().target);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('runs one guarded Yahoo refresh and sanitizes its provider result', async () => {
    const refresh = vi.fn().mockResolvedValue({
      success: false,
      requestedPlatforms: ['yahoo'],
      results: {
        yahoo: {
          platform: 'yahoo',
          status: 'error',
          httpStatus: 429,
          error: 'yahoo_api_temporarily_unavailable',
          retryAfter: '120',
          details: { upstream_status: 999, retryable: true, count: 0 },
        },
      },
    });
    const request = validRequest(false);

    const result = await runYahooTargetedRecovery(env, request, {
      now: () => Date.parse('2026-09-08T21:00:00.000Z'),
      refresh,
    });

    expect(refresh).toHaveBeenCalledWith(
      env, request.target, ['yahoo'], {}, expect.any(String), 'scheduled'
    );
    expect(result).toMatchObject({
      outcome: 'processed',
      dryRun: false,
      targetIndex: 5,
      provider: {
        status: 'error',
        httpStatus: 429,
        error: 'yahoo_api_temporarily_unavailable',
        upstreamStatus: 999,
        retryAfterSeconds: 120,
        leagueCount: 0,
        stopReason: 'rate_limited',
      },
    });
  });

  it('preserves the normal missing-credentials no-op result', async () => {
    const refresh = vi.fn().mockResolvedValue({
      success: false,
      requestedPlatforms: ['yahoo'],
      results: {
        yahoo: { platform: 'yahoo', status: 'skipped', httpStatus: 404, error: 'not_connected' },
      },
    });

    const result = await runYahooTargetedRecovery(env, validRequest(false), {
      now: () => Date.parse('2026-09-08T21:00:00.000Z'),
      refresh,
    });

    expect(result).toMatchObject({
      outcome: 'processed',
      provider: { status: 'skipped', httpStatus: 404, error: 'not_connected', stopReason: null },
    });
  });

  it('surfaces the exact app-level Yahoo denial as a fleet stop signal', async () => {
    const refresh = vi.fn().mockResolvedValue({
      success: false,
      requestedPlatforms: ['yahoo'],
      results: {
        yahoo: {
          platform: 'yahoo',
          status: 'error',
          httpStatus: 502,
          error: 'yahoo_api_error',
          error_description: YAHOO_APP_REVIEW_OUTAGE_MESSAGE.discovery,
          details: { upstream_status: 403 },
        },
      },
    });

    const result = await runYahooTargetedRecovery(env, validRequest(false), {
      now: () => Date.parse('2026-09-08T21:00:00.000Z'),
      refresh,
    });

    expect(result).toMatchObject({
      outcome: 'processed',
      provider: { upstreamStatus: 403, stopReason: 'provider_denied' },
    });
  });

  it('expires before reading or refreshing an account', async () => {
    const snapshot = vi.fn();
    const refresh = vi.fn();
    const result = await runYahooTargetedRecovery(env, validRequest(false), {
      now: () => Date.parse(YAHOO_TARGETED_RECOVERY_EXPIRES_AT),
      snapshot,
      refresh,
    });

    expect(result).toMatchObject({ outcome: 'expired', dryRun: false, targetIndex: 5 });
    expect(snapshot).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
