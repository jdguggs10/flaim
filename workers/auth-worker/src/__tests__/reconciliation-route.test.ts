import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../reconciliation', () => ({
  runReconciliation: vi.fn(),
}));

import app from '../index-hono';
import { runReconciliation, type ReconciliationRunSummary } from '../reconciliation';

const INTERNAL_SERVICE_TOKEN = 'internal-reconciliation-secret';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
  INTERNAL_SERVICE_TOKEN,
  TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CREDENTIALS_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

function summaryWith(outcome: ReconciliationRunSummary['outcome']): ReconciliationRunSummary {
  return {
    runId: 'run-1',
    trigger: 'manual',
    outcome,
    dryRun: true,
    eligibleUsers: 0,
    selectedUsers: 0,
    probes: { probed: 0, notConnected: 0, skippedLease: 0, skippedBudget: 0, errors: 0 },
    wouldInsertTotal: 0,
    alreadyPresentTotal: 0,
    durationMs: 5,
  };
}

function makeRequest(token?: string): Request {
  return new Request('https://auth.example.com/auth/internal/reconciliation/run', {
    method: 'POST',
    headers: token ? { 'X-Flaim-Internal-Token': token } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /auth/internal/reconciliation/run', () => {
  it('rejects requests without the internal service token', async () => {
    const res = await app.fetch(makeRequest(), baseEnv);
    expect(res.status).toBe(403);
    expect(runReconciliation).not.toHaveBeenCalled();
  });

  it('rejects requests with a wrong token', async () => {
    const res = await app.fetch(makeRequest('wrong-token'), baseEnv);
    expect(res.status).toBe(403);
    expect(runReconciliation).not.toHaveBeenCalled();
  });

  it('fails closed when no internal token is configured', async () => {
    const env = { ...baseEnv, INTERNAL_SERVICE_TOKEN: undefined };
    const res = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), env);
    expect(res.status).toBe(500);
    expect(runReconciliation).not.toHaveBeenCalled();
  });

  it('runs a manual reconciliation and returns the summary', async () => {
    vi.mocked(runReconciliation).mockResolvedValue(summaryWith('completed'));

    const res = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv);
    expect(res.status).toBe(200);
    expect(runReconciliation).toHaveBeenCalledWith(baseEnv, 'manual');
    const body = await res.json() as ReconciliationRunSummary;
    expect(body.outcome).toBe('completed');
    expect(body.dryRun).toBe(true);
  });

  it('returns 409 when the job is disabled or refuses to run', async () => {
    vi.mocked(runReconciliation).mockResolvedValue(summaryWith('disabled'));
    const disabledRes = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv);
    expect(disabledRes.status).toBe(409);

    vi.mocked(runReconciliation).mockResolvedValue(summaryWith('refused_not_dry_run'));
    const refusedRes = await app.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv);
    expect(refusedRes.status).toBe(409);
  });
});
