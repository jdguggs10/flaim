import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../reconciliation', () => ({
  runReconciliation: vi.fn(),
}));

vi.mock('../espn-history-backfill', () => ({
  runEspnHistoryBackfill: vi.fn(),
}));

import worker, { runScheduledAuthWorkerTask, type Env } from '../index-hono';
import { runReconciliation } from '../reconciliation';
import {
  runEspnHistoryBackfill,
  type EspnHistoryBackfillOutcome,
  type EspnHistoryBackfillSummary,
} from '../espn-history-backfill';

const INTERNAL_SERVICE_TOKEN = 'internal-backfill-secret';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
  INTERNAL_SERVICE_TOKEN,
  ESPN_HISTORY_REFRESH: { create: vi.fn() },
  TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CREDENTIALS_RATE_LIMITER: { limit: async () => ({ success: true }) },
} satisfies Env;

function summaryWith(outcome: EspnHistoryBackfillOutcome): EspnHistoryBackfillSummary {
  return { trigger: 'manual', outcome, mode: outcome === 'disabled' ? 'off' : 'allowlist', selectedUsers: 0 };
}

function makeRequest(token?: string): Request {
  return new Request('https://auth.example.com/auth/internal/backfill/espn-history', {
    method: 'POST',
    headers: token ? { 'X-Flaim-Internal-Token': token } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /auth/internal/backfill/espn-history', () => {
  it('requires the internal service token', async () => {
    const response = await worker.fetch(makeRequest(), baseEnv);

    expect(response.status).toBe(403);
    expect(runEspnHistoryBackfill).not.toHaveBeenCalled();
  });

  it('runs one manual claim and reports whether the migration is enabled', async () => {
    vi.mocked(runEspnHistoryBackfill).mockResolvedValue(summaryWith('queued'));
    const queued = await worker.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv);
    expect(queued.status).toBe(200);
    expect(runEspnHistoryBackfill).toHaveBeenCalledWith(baseEnv, 'manual');

    vi.mocked(runEspnHistoryBackfill).mockResolvedValue(summaryWith('disabled'));
    const disabled = await worker.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv);
    expect(disabled.status).toBe(409);

    vi.mocked(runEspnHistoryBackfill).mockResolvedValue(summaryWith('failed'));
    const failed = await worker.fetch(makeRequest(INTERNAL_SERVICE_TOKEN), baseEnv);
    expect(failed.status).toBe(500);
  });
});

describe('auth-worker cron routing', () => {
  it('routes each known cron to only its intended task', async () => {
    await runScheduledAuthWorkerTask({ cron: '17 10 * * *' }, baseEnv);
    expect(runReconciliation).toHaveBeenCalledWith(baseEnv, 'cron');
    expect(runEspnHistoryBackfill).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await runScheduledAuthWorkerTask({ cron: '*/5 * * * *' }, baseEnv);
    expect(runEspnHistoryBackfill).toHaveBeenCalledWith(baseEnv, 'cron');
    expect(runReconciliation).not.toHaveBeenCalled();
  });

  it('fails closed for an unknown cron', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runScheduledAuthWorkerTask({ cron: '* * * * *' }, baseEnv);

    expect(runReconciliation).not.toHaveBeenCalled();
    expect(runEspnHistoryBackfill).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
