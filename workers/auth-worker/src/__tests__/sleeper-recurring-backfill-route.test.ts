import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sleeper-recurring-backfill', async () => {
  const actual = await vi.importActual<typeof import('../sleeper-recurring-backfill')>('../sleeper-recurring-backfill');
  return {
    ...actual,
    runSleeperRecurringBackfill: vi.fn(),
  };
});

import app from '../index-hono';
import { runSleeperRecurringBackfill, type SleeperRecurringBackfillSummary } from '../sleeper-recurring-backfill';

const INTERNAL_SERVICE_TOKEN = 'internal-backfill-secret';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
  INTERNAL_SERVICE_TOKEN,
  TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CREDENTIALS_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

function summary(dryRun: boolean): SleeperRecurringBackfillSummary {
  return dryRun
    ? { outcome: 'completed', dryRun: true, usersScanned: 1, rowsProcessed: 1, rowsResolved: 1, rowsUnresolved: 0, rowsWouldChange: 1, rowsSkippedConcurrent: 0, errors: 0 }
    : { outcome: 'completed', dryRun: false, usersScanned: 1, rowsProcessed: 1, rowsResolved: 1, rowsUnresolved: 0, rowsChanged: 1, rowsSkippedConcurrent: 0, errors: 0, leaseCleanup: 'ok' };
}

function makeRequest(token?: string, body?: string): Request {
  return new Request('https://auth.example.com/auth/internal/backfill/sleeper-recurring-ids', {
    method: 'POST',
    headers: token ? { 'X-Flaim-Internal-Token': token } : {},
    ...(body !== undefined ? { body } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /auth/internal/backfill/sleeper-recurring-ids', () => {
  it('rejects requests without the internal service token', async () => {
    const res = await app.fetch(makeRequest(), baseEnv);
    expect(res.status).toBe(403);
    expect(runSleeperRecurringBackfill).not.toHaveBeenCalled();
  });

  it('rejects requests with a wrong token', async () => {
    const res = await app.fetch(makeRequest('wrong-token'), baseEnv);
    expect(res.status).toBe(403);
    expect(runSleeperRecurringBackfill).not.toHaveBeenCalled();
  });

  it('fails closed when no internal token is configured', async () => {
    const env = { ...baseEnv, INTERNAL_SERVICE_TOKEN: undefined };
    const res = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), env);
    expect(res.status).toBe(500);
    expect(runSleeperRecurringBackfill).not.toHaveBeenCalled();
  });

  it('defaults to dry-run when the request body is unspecified', async () => {
    vi.mocked(runSleeperRecurringBackfill).mockResolvedValue(summary(true));

    const res = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv);

    expect(res.status).toBe(200);
    expect(runSleeperRecurringBackfill).toHaveBeenCalledWith(baseEnv, true);
    const body = await res.json() as SleeperRecurringBackfillSummary;
    expect(body.dryRun).toBe(true);
  });

  it('runs and returns the summary for an explicit dryRun:false', async () => {
    vi.mocked(runSleeperRecurringBackfill).mockResolvedValue(summary(false));

    const res = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN, '{"dryRun":false}'), baseEnv);

    expect(res.status).toBe(200);
    expect(runSleeperRecurringBackfill).toHaveBeenCalledWith(baseEnv, false);
    const body = await res.json() as SleeperRecurringBackfillSummary;
    expect(body.outcome).toBe('completed');
    expect(body.dryRun).toBe(false);
  });

  it('rejects a malformed body with 400 instead of falling back to dry-run', async () => {
    const res = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN, '{not json'), baseEnv);
    expect(res.status).toBe(400);
    expect(runSleeperRecurringBackfill).not.toHaveBeenCalled();
  });

  it('returns 409 when a concurrent live run already holds the backfill lease', async () => {
    vi.mocked(runSleeperRecurringBackfill).mockResolvedValue({
      outcome: 'blocked',
      dryRun: false,
      usersScanned: 0,
      rowsProcessed: 0,
      rowsResolved: 0,
      rowsUnresolved: 0,
      rowsChanged: 0,
      rowsSkippedConcurrent: 0,
      errors: 0,
    });

    const res = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN, '{"dryRun":false}'), baseEnv);

    expect(res.status).toBe(409);
    const body = await res.json() as SleeperRecurringBackfillSummary;
    expect(body.outcome).toBe('blocked');
  });
});
