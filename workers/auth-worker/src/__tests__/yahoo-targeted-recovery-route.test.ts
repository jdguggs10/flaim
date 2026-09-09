import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../yahoo-targeted-recovery', async () => {
  const actual = await vi.importActual<typeof import('../yahoo-targeted-recovery')>(
    '../yahoo-targeted-recovery'
  );
  return {
    ...actual,
    parseYahooTargetedRecoveryRequest: vi.fn(),
    runYahooTargetedRecovery: vi.fn(),
  };
});

import app from '../index-hono';
import {
  parseYahooTargetedRecoveryRequest,
  runYahooTargetedRecovery,
  type YahooTargetedRecoveryRequest,
  type YahooTargetedRecoverySummary,
} from '../yahoo-targeted-recovery';

const INTERNAL_SERVICE_TOKEN = 'internal-recovery-secret';
const recoveryRequest: YahooTargetedRecoveryRequest = {
  manifest: ['user_00000000000000000000'],
  target: 'user_00000000000000000000',
  dryRun: true,
};
const dryRunSummary: YahooTargetedRecoverySummary = {
  outcome: 'dry_run',
  dryRun: true,
  expiresAt: '2026-09-09T12:00:00.000Z',
  targetMasked: 'user_000...',
  targetIndex: 0,
  snapshot: {
    credentialsPresent: true,
    leagueRows: 4,
    sync: {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorCode: null,
      syncLeaseExpiresAt: null,
    },
  },
};

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
  INTERNAL_SERVICE_TOKEN,
  TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CREDENTIALS_RATE_LIMITER: { limit: async () => ({ success: true }) },
  WEBHOOK_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

function makeRequest(token?: string): Request {
  return new Request('https://auth.example.com/auth/internal/backfill/yahoo-recovery', {
    method: 'POST',
    headers: token ? { 'X-Flaim-Internal-Token': token } : {},
    body: '{}',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /auth/internal/backfill/yahoo-recovery', () => {
  it('rejects missing or incorrect internal service authentication before parsing', async () => {
    const missing = await app.fetch(makeRequest(), baseEnv);
    const incorrect = await app.fetch(makeRequest('wrong-token'), baseEnv);

    expect(missing.status).toBe(403);
    expect(incorrect.status).toBe(403);
    expect(parseYahooTargetedRecoveryRequest).not.toHaveBeenCalled();
    expect(runYahooTargetedRecovery).not.toHaveBeenCalled();
  });

  it('fails closed when no internal service token is configured', async () => {
    const response = await app.fetch(
      makeRequest(INTERNAL_SERVICE_TOKEN),
      { ...baseEnv, INTERNAL_SERVICE_TOKEN: undefined }
    );

    expect(response.status).toBe(500);
    expect(parseYahooTargetedRecoveryRequest).not.toHaveBeenCalled();
    expect(runYahooTargetedRecovery).not.toHaveBeenCalled();
  });

  it('returns request validation errors without running recovery', async () => {
    vi.mocked(parseYahooTargetedRecoveryRequest).mockResolvedValue({
      error: {
        status: 413,
        body: { error: 'request_too_large', error_description: 'Request body exceeds 8192 bytes' },
      },
    });

    const response = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv);

    expect(response.status).toBe(413);
    expect(runYahooTargetedRecovery).not.toHaveBeenCalled();
  });

  it('binds a validated request to the recovery implementation', async () => {
    vi.mocked(parseYahooTargetedRecoveryRequest).mockResolvedValue({ request: recoveryRequest });
    vi.mocked(runYahooTargetedRecovery).mockResolvedValue(dryRunSummary);

    const response = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv);

    expect(response.status).toBe(200);
    expect(parseYahooTargetedRecoveryRequest).toHaveBeenCalledTimes(1);
    expect(runYahooTargetedRecovery).toHaveBeenCalledWith(baseEnv, recoveryRequest);
    await expect(response.json()).resolves.toEqual(dryRunSummary);
  });

  it.each([
    ['expired', 410],
    ['failed', 500],
  ] as const)('maps the %s recovery outcome to HTTP %d', async (outcome, status) => {
    vi.mocked(parseYahooTargetedRecoveryRequest).mockResolvedValue({ request: recoveryRequest });
    vi.mocked(runYahooTargetedRecovery).mockResolvedValue(
      outcome === 'expired'
        ? { outcome, dryRun: true, expiresAt: dryRunSummary.expiresAt, targetIndex: 0 }
        : {
            outcome,
            dryRun: true,
            expiresAt: dryRunSummary.expiresAt,
            targetMasked: 'user_000...',
            targetIndex: 0,
            error: 'snapshot_failed',
          }
    );

    const response = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv);

    expect(response.status).toBe(status);
  });
});
