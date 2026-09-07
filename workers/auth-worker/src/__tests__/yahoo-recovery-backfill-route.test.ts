import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../yahoo-recovery-backfill', async () => {
  const actual = await vi.importActual<typeof import('../yahoo-recovery-backfill')>('../yahoo-recovery-backfill');
  return { ...actual, runYahooRecovery: vi.fn() };
});

import app from '../index-hono';
import {
  YAHOO_RECOVERY_CUTOFF,
  YAHOO_RECOVERY_EXPIRES_AT,
  runYahooRecovery,
  type YahooRecoverySummary,
} from '../yahoo-recovery-backfill';

const INTERNAL_SERVICE_TOKEN = 'internal-yahoo-recovery-secret';
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

function summary(outcome: YahooRecoverySummary['outcome'], dryRun = true): YahooRecoverySummary {
  return {
    outcome,
    dryRun,
    cutoff: YAHOO_RECOVERY_CUTOFF,
    expiresAt: YAHOO_RECOVERY_EXPIRES_AT,
    cursor: null,
    nextCursor: null,
  };
}

function makeRequest(token?: string, body?: string): Request {
  return new Request('https://auth.example.com/auth/internal/backfill/yahoo-recovery', {
    method: 'POST',
    headers: token ? { 'X-Flaim-Internal-Token': token } : {},
    ...(body === undefined ? {} : { body }),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('POST /auth/internal/backfill/yahoo-recovery', () => {
  it('requires the internal service token and no user bearer token', async () => {
    expect((await app.fetch(makeRequest(), baseEnv)).status).toBe(403);
    expect((await app.fetch(makeRequest('wrong'), baseEnv)).status).toBe(403);
    expect(runYahooRecovery).not.toHaveBeenCalled();
  });

  it('fails closed when the internal service token is not configured', async () => {
    const response = await app.fetch(
      makeRequest(INTERNAL_SERVICE_TOKEN),
      { ...baseEnv, INTERNAL_SERVICE_TOKEN: undefined }
    );
    expect(response.status).toBe(500);
    expect(runYahooRecovery).not.toHaveBeenCalled();
  });

  it('defaults to the first-page dry run', async () => {
    vi.mocked(runYahooRecovery).mockResolvedValue(summary('dry_run'));
    const response = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv);
    expect(response.status).toBe(200);
    expect(runYahooRecovery).toHaveBeenCalledWith(baseEnv, { dryRun: true, cursor: null });
  });

  it('accepts only explicit apply and an opaque cursor', async () => {
    vi.mocked(runYahooRecovery).mockResolvedValue(summary('processed', false));
    const response = await app.fetch(
      makeRequest(INTERNAL_SERVICE_TOKEN, '{"dryRun":false,"cursor":"dXNlcl8x"}'),
      baseEnv
    );
    expect(response.status).toBe(200);
    expect(runYahooRecovery).toHaveBeenCalledWith(baseEnv, { dryRun: false, cursor: 'dXNlcl8x' });
  });

  it('rejects malformed input without running recovery', async () => {
    const response = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN, '{bad'), baseEnv);
    expect(response.status).toBe(400);
    expect(runYahooRecovery).not.toHaveBeenCalled();
  });

  it('maps expired and internal failure outcomes to non-success statuses', async () => {
    vi.mocked(runYahooRecovery).mockResolvedValueOnce(summary('expired'));
    expect((await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv)).status).toBe(410);

    vi.mocked(runYahooRecovery).mockResolvedValueOnce(summary('failed'));
    expect((await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv)).status).toBe(500);
  });
});
