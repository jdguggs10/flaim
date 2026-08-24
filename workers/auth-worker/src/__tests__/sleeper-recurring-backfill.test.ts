import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockBackfillSleeperRecurringIds = vi.hoisted(() => vi.fn());

vi.mock('../sleeper-connect-handlers', () => ({
  backfillSleeperRecurringIds: mockBackfillSleeperRecurringIds,
}));

/**
 * Supabase stub whose sleeper_leagues table is select-only: reaching for any
 * write method throws — same no-write-guarantee shape as reconciliation.test.ts's
 * supabaseStub. This module's own snapshot query never writes; all writes go
 * through backfillSleeperRecurringIds, which is mocked above.
 */
const supabaseStub = vi.hoisted(() => {
  const state: {
    rows: Array<{ clerk_user_id: string }>;
    selectColumns: string[];
    isCalls: Array<{ column: string; value: unknown }>;
    rangeCalls: Array<[number, number]>;
  } = { rows: [], selectColumns: [], isCalls: [], rangeCalls: [] };

  const writeAttempt = (method: string) => () => {
    throw new Error(`WRITE ATTEMPTED: ${method}`);
  };

  const client = {
    from(_table: string) {
      const builder = {
        select: (columns: string) => {
          state.selectColumns.push(columns);
          return builder;
        },
        is: (column: string, value: unknown) => {
          state.isCalls.push({ column, value });
          return builder;
        },
        order: () => builder,
        range: (from: number, to: number) => {
          state.rangeCalls.push([from, to]);
          return Promise.resolve({ data: state.rows.slice(from, to + 1), error: null });
        },
        insert: writeAttempt('insert'),
        update: writeAttempt('update'),
        upsert: writeAttempt('upsert'),
        delete: writeAttempt('delete'),
      };
      return builder;
    },
  };

  return { state, client };
});

const createClientMock = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

import { parseSleeperRecurringBackfillRequest, runSleeperRecurringBackfill } from '../sleeper-recurring-backfill';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
};

beforeEach(() => {
  vi.clearAllMocks();
  supabaseStub.state.rows = [];
  supabaseStub.state.selectColumns = [];
  supabaseStub.state.isCalls = [];
  supabaseStub.state.rangeCalls = [];
  createClientMock.mockReturnValue(supabaseStub.client);
});

describe('runSleeperRecurringBackfill', () => {
  it('selects only clerk_user_id filtered on a NULL recurring_league_id, deduping distinct users', async () => {
    supabaseStub.state.rows = [
      { clerk_user_id: 'user_a' },
      { clerk_user_id: 'user_a' },
      { clerk_user_id: 'user_b' },
    ];
    mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 1, resolved: 1, changed: 0 });

    const summary = await runSleeperRecurringBackfill(baseEnv, true);

    expect(supabaseStub.state.selectColumns).toEqual(['clerk_user_id']);
    expect(supabaseStub.state.isCalls).toEqual([{ column: 'recurring_league_id', value: null }]);
    expect(summary.usersScanned).toBe(2);
    expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledTimes(2);
    expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledWith(baseEnv, 'user_a', { dryRun: true });
    expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledWith(baseEnv, 'user_b', { dryRun: true });
  });

  it('paginates the snapshot query in pages of 1000 instead of loading the whole table', async () => {
    supabaseStub.state.rows = Array.from({ length: 1500 }, (_, i) => ({ clerk_user_id: `user_${i}` }));
    mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 1, resolved: 1, changed: 0 });

    const summary = await runSleeperRecurringBackfill(baseEnv, true);

    expect(supabaseStub.state.rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(summary.usersScanned).toBe(1500);
  });

  it('propagates dryRun:true to every user call and aggregates rowsWouldChange', async () => {
    supabaseStub.state.rows = [{ clerk_user_id: 'user_a' }];
    mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 3, resolved: 2, changed: 2 });

    const summary = await runSleeperRecurringBackfill(baseEnv, true);

    expect(summary.dryRun).toBe(true);
    expect(summary.rowsProcessed).toBe(3);
    expect(summary.rowsResolved).toBe(2);
    if (summary.dryRun) {
      expect(summary.rowsWouldChange).toBe(2);
    }
  });

  it('propagates dryRun:false to every user call and aggregates rowsChanged', async () => {
    supabaseStub.state.rows = [{ clerk_user_id: 'user_a' }];
    mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 3, resolved: 3, changed: 1 });

    const summary = await runSleeperRecurringBackfill(baseEnv, false);

    expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledWith(baseEnv, 'user_a', { dryRun: false });
    expect(summary.dryRun).toBe(false);
    if (!summary.dryRun) {
      expect(summary.rowsChanged).toBe(1);
    }
  });

  it("isolates one user's failure so the rest of the batch still completes", async () => {
    supabaseStub.state.rows = [
      { clerk_user_id: 'user_a' },
      { clerk_user_id: 'user_b' },
      { clerk_user_id: 'user_c' },
    ];
    mockBackfillSleeperRecurringIds.mockImplementation(async (_env: unknown, userId: string) => {
      if (userId === 'user_b') throw new Error('boom');
      return { processed: 1, resolved: 1, changed: 1 };
    });

    const summary = await runSleeperRecurringBackfill(baseEnv, false);

    expect(summary.outcome).toBe('completed');
    expect(summary.usersScanned).toBe(3);
    expect(summary.errors).toBe(1);
    expect(summary.rowsProcessed).toBe(2);
  });
});

describe('parseSleeperRecurringBackfillRequest', () => {
  function makeRequest(body?: string): Request {
    return new Request('https://auth.example.com/internal/backfill/sleeper-recurring-ids', {
      method: 'POST',
      ...(body !== undefined ? { body } : {}),
    });
  }

  it('defaults to dryRun:true when the body is empty', async () => {
    const result = await parseSleeperRecurringBackfillRequest(makeRequest());
    expect(result).toEqual({ dryRun: true });
  });

  it('defaults to dryRun:true when dryRun is omitted from a JSON object body', async () => {
    const result = await parseSleeperRecurringBackfillRequest(makeRequest('{}'));
    expect(result).toEqual({ dryRun: true });
  });

  it('accepts an explicit dryRun:false', async () => {
    const result = await parseSleeperRecurringBackfillRequest(makeRequest('{"dryRun":false}'));
    expect(result).toEqual({ dryRun: false });
  });

  it('refuses malformed JSON rather than silently falling back to the default', async () => {
    const result = await parseSleeperRecurringBackfillRequest(makeRequest('{not json'));
    expect(result.dryRun).toBeUndefined();
    expect(result.error?.status).toBe(400);
  });

  it('refuses a non-boolean dryRun rather than coercing it', async () => {
    const result = await parseSleeperRecurringBackfillRequest(makeRequest('{"dryRun":"false"}'));
    expect(result.dryRun).toBeUndefined();
    expect(result.error?.status).toBe(400);
  });
});
