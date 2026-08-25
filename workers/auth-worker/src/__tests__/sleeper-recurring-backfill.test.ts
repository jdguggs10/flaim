import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockBackfillSleeperRecurringIds = vi.hoisted(() => vi.fn());

vi.mock('../sleeper-connect-handlers', () => ({
  backfillSleeperRecurringIds: mockBackfillSleeperRecurringIds,
}));

/**
 * Mock the single-flight lease (audit FLA-168 Fix 5) at the SyncStateStorage
 * level rather than through the shared supabase stub below: acquireLease's
 * fail-open behavior would otherwise mask real acquire/release call
 * assertions behind a swallowed "WRITE ATTEMPTED" error.
 */
const mockAcquireLease = vi.hoisted(() => vi.fn());
const mockExtendLease = vi.hoisted(() => vi.fn());
const mockDeleteLeaseRow = vi.hoisted(() => vi.fn());
vi.mock('../sync-state', () => ({
  SyncStateStorage: {
    fromEnvironment: vi.fn(() => ({
      acquireLease: mockAcquireLease,
      extendLease: mockExtendLease,
      deleteLeaseRow: mockDeleteLeaseRow,
    })),
  },
}));

/**
 * Supabase stub whose sleeper_leagues table is select-only: reaching for any
 * write method throws — same no-write-guarantee shape as reconciliation.test.ts's
 * supabaseStub. This module's own snapshot query never writes; all writes go
 * through backfillSleeperRecurringIds, which is mocked above.
 *
 * Paginates by keyset (`.gt('clerk_user_id', lastSeen).limit(n)`), matching
 * the production query (round-3 audit finding replacing numeric-offset
 * `.range()` pagination). `state.rows` is re-sorted and re-filtered by the
 * live `gtValue` on every `.limit()` call rather than snapshotted once, so a
 * test can mutate `state.rows` between pages to simulate a concurrent write
 * shrinking the candidate set mid-scan.
 */
const supabaseStub = vi.hoisted(() => {
  const state: {
    rows: Array<{ clerk_user_id: string }>;
    selectColumns: string[];
    isCalls: Array<{ column: string; value: unknown }>;
    gtCalls: Array<{ column: string; value: unknown }>;
    limitCalls: number[];
    /** Fires right as a `.gt()` cursor call is made (i.e. just before a page
     *  after the first is fetched) — lets a test mutate `state.rows` exactly
     *  between two pages, to simulate a concurrent write landing mid-scan. */
    onGt?: () => void;
  } = { rows: [], selectColumns: [], isCalls: [], gtCalls: [], limitCalls: [] };

  const writeAttempt = (method: string) => () => {
    throw new Error(`WRITE ATTEMPTED: ${method}`);
  };

  const client = {
    from(_table: string) {
      let gtValue: string | undefined;
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
        gt: (column: string, value: unknown) => {
          state.gtCalls.push({ column, value });
          gtValue = value as string;
          state.onGt?.();
          return builder;
        },
        limit: (n: number) => {
          state.limitCalls.push(n);
          const sorted = [...state.rows].sort((a, b) => a.clerk_user_id.localeCompare(b.clerk_user_id));
          const filtered = gtValue !== undefined ? sorted.filter((r) => r.clerk_user_id > gtValue!) : sorted;
          return Promise.resolve({ data: filtered.slice(0, n), error: null });
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
  supabaseStub.state.gtCalls = [];
  supabaseStub.state.limitCalls = [];
  supabaseStub.state.onGt = undefined;
  createClientMock.mockReturnValue(supabaseStub.client);
  // Default: lease always available and renews cleanly, so existing
  // dryRun:false tests exercise the normal run path unless a test overrides
  // this to simulate contention or a stolen lease.
  mockAcquireLease.mockResolvedValue({ acquired: true });
  mockExtendLease.mockResolvedValue(true);
  // deleteLeaseRow now reports success/failure (round-3 audit finding); tests
  // that care about a failed cleanup override this to false.
  mockDeleteLeaseRow.mockResolvedValue(true);
});

describe('runSleeperRecurringBackfill', () => {
  it('selects only clerk_user_id filtered on a NULL recurring_league_id, deduping distinct users', async () => {
    supabaseStub.state.rows = [
      { clerk_user_id: 'user_a' },
      { clerk_user_id: 'user_a' },
      { clerk_user_id: 'user_b' },
    ];
    mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 1, resolved: 1, changed: 0, unresolved: 0, skippedConcurrent: 0 });

    const summary = await runSleeperRecurringBackfill(baseEnv, true);

    expect(supabaseStub.state.selectColumns).toEqual(['clerk_user_id']);
    expect(supabaseStub.state.isCalls).toEqual([{ column: 'recurring_league_id', value: null }]);
    expect(summary.usersScanned).toBe(2);
    expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledTimes(2);
    expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledWith(baseEnv, 'user_a', { dryRun: true });
    expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledWith(baseEnv, 'user_b', { dryRun: true });
  });

  it('paginates the snapshot query in pages of 1000 by keyset, not the whole table at once', async () => {
    // Zero-padded so string sort order equals numeric order, matching
    // Postgres's `ORDER BY clerk_user_id`.
    const userId = (i: number) => `user_${String(i).padStart(4, '0')}`;
    supabaseStub.state.rows = Array.from({ length: 1500 }, (_, i) => ({ clerk_user_id: userId(i) }));
    mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 1, resolved: 1, changed: 0, unresolved: 0, skippedConcurrent: 0 });

    const summary = await runSleeperRecurringBackfill(baseEnv, true);

    // First page has no cursor; second page keys off the last row of the first.
    expect(supabaseStub.state.gtCalls).toEqual([{ column: 'clerk_user_id', value: userId(999) }]);
    expect(supabaseStub.state.limitCalls).toEqual([1000, 1000]);
    expect(summary.usersScanned).toBe(1500);
  });

  it('keyset pagination still covers every user when earlier rows are resolved out from under the scan mid-run (round-3 audit finding)', async () => {
    // Numeric-offset pagination would have re-based page 2 on the SHRUNKEN
    // table (after concurrent normal sync fills some earlier NULLs), silently
    // skipping a contiguous block of users near the tail: with 1500 rows and
    // a page size of 1000, removing the first 300 rows before page 2 fetches
    // `.range(1000, 1999)` would shift indices so page 2 actually returns
    // rows 1300-1499, silently dropping rows 1000-1299 (300 users) that
    // neither page ever touches. Keyset pagination must be unaffected, since
    // it cursors on the last VALUE seen (user_0999), not a position.
    const userId = (i: number) => `user_${String(i).padStart(4, '0')}`;
    supabaseStub.state.rows = Array.from({ length: 1500 }, (_, i) => ({ clerk_user_id: userId(i) }));
    mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 1, resolved: 1, changed: 0, unresolved: 0, skippedConcurrent: 0 });
    // Fires right before page 2's query executes (i.e. exactly between the
    // two pages) — simulates a concurrent normal sync resolving the first 300
    // users' recurring_league_id in that window.
    supabaseStub.state.onGt = () => {
      supabaseStub.state.rows = supabaseStub.state.rows.filter((row) => row.clerk_user_id > userId(299));
    };

    const summary = await runSleeperRecurringBackfill(baseEnv, true);

    // All 1500 users are still scanned — none silently dropped despite the
    // underlying table shrinking mid-scan.
    expect(summary.usersScanned).toBe(1500);
    expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledWith(baseEnv, userId(1499), { dryRun: true });
    expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledWith(baseEnv, userId(0), { dryRun: true });
  });

  it('propagates dryRun:true to every user call and aggregates rowsWouldChange and rowsUnresolved', async () => {
    supabaseStub.state.rows = [{ clerk_user_id: 'user_a' }];
    mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 3, resolved: 2, changed: 2, unresolved: 1, skippedConcurrent: 0 });

    const summary = await runSleeperRecurringBackfill(baseEnv, true);

    expect(summary.dryRun).toBe(true);
    expect(summary.rowsProcessed).toBe(3);
    expect(summary.rowsResolved).toBe(2);
    expect(summary.rowsUnresolved).toBe(1);
    if (summary.dryRun) {
      expect(summary.rowsWouldChange).toBe(2);
    }
  });

  it('propagates dryRun:false to every user call and aggregates rowsChanged', async () => {
    supabaseStub.state.rows = [{ clerk_user_id: 'user_a' }];
    mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 3, resolved: 3, changed: 1, unresolved: 0, skippedConcurrent: 0 });

    const summary = await runSleeperRecurringBackfill(baseEnv, false);

    // A live run threads a per-row lease-renewal checkpoint down into every
    // backfillSleeperRecurringIds call (round-4 audit finding) — dryRun still
    // matches exactly, but the options object now also carries
    // onRowCheckpoint (absent for dry runs; see the `dryRun: true` tests
    // above, unaffected).
    expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledWith(baseEnv, 'user_a', { dryRun: false, onRowCheckpoint: expect.any(Function) });
    expect(summary.dryRun).toBe(false);
    if (!summary.dryRun) {
      expect(summary.rowsChanged).toBe(1);
    }
  });

  it('aggregates rowsSkippedConcurrent across users (round-3 audit finding)', async () => {
    supabaseStub.state.rows = [
      { clerk_user_id: 'user_a' },
      { clerk_user_id: 'user_b' },
    ];
    mockBackfillSleeperRecurringIds.mockImplementation(async (_env: unknown, userId: string) =>
      userId === 'user_a'
        ? { processed: 2, resolved: 2, changed: 1, unresolved: 0, skippedConcurrent: 1 }
        : { processed: 1, resolved: 1, changed: 0, unresolved: 0, skippedConcurrent: 1 }
    );

    const summary = await runSleeperRecurringBackfill(baseEnv, false);

    expect(summary.rowsSkippedConcurrent).toBe(2);
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
      return { processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 };
    });

    const summary = await runSleeperRecurringBackfill(baseEnv, false);

    expect(summary.outcome).toBe('completed');
    expect(summary.usersScanned).toBe(3);
    expect(summary.errors).toBe(1);
    expect(summary.rowsProcessed).toBe(2);
  });

  it('acquires the single-flight lease before a live run and deletes its row under the same owner when done', async () => {
    supabaseStub.state.rows = [{ clerk_user_id: 'user_a' }];
    mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 });

    const summary = await runSleeperRecurringBackfill(baseEnv, false);

    expect(mockAcquireLease).toHaveBeenCalledTimes(1);
    const [acquireUserId, acquireProvider, acquireOwner, acquireTtlMs] = mockAcquireLease.mock.calls[0];
    expect(acquireUserId).toBe('__backfill__');
    expect(acquireProvider).toBe('sleeper');
    // Round-3 audit finding: an explicit 15-minute TTL, not sync-state.ts's
    // 120s default sized for a single provider refresh.
    expect(acquireTtlMs).toBe(15 * 60 * 1000);

    // Audit FLA-168 Fix 3: the synthetic row is deleted outright on a normal
    // finish, not released back to an unheld state.
    expect(mockDeleteLeaseRow).toHaveBeenCalledTimes(1);
    const [deleteUserId, deleteProvider, deleteOwner] = mockDeleteLeaseRow.mock.calls[0];
    expect(deleteUserId).toBe('__backfill__');
    expect(deleteProvider).toBe('sleeper');
    expect(deleteOwner).toBe(acquireOwner);
    // Round-3 audit finding: a successful cleanup delete is surfaced in the response.
    expect(summary.leaseCleanup).toBe('ok');
  });

  it('reports a failed lease cleanup in the response without changing the run outcome (round-3 audit finding)', async () => {
    supabaseStub.state.rows = [{ clerk_user_id: 'user_a' }];
    mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 });
    mockDeleteLeaseRow.mockResolvedValue(false);

    const summary = await runSleeperRecurringBackfill(baseEnv, false);

    expect(summary.outcome).toBe('completed');
    expect(summary.leaseCleanup).toBe('failed');
  });

  it('skips the lease entirely for a dry run', async () => {
    supabaseStub.state.rows = [{ clerk_user_id: 'user_a' }];
    mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 });

    const summary = await runSleeperRecurringBackfill(baseEnv, true);

    expect(mockAcquireLease).not.toHaveBeenCalled();
    expect(mockExtendLease).not.toHaveBeenCalled();
    expect(mockDeleteLeaseRow).not.toHaveBeenCalled();
    // No lease was ever held, so there's nothing to report cleanup for.
    expect(summary.leaseCleanup).toBeUndefined();
  });

  it('returns a blocked outcome for a 409 when a concurrent live run already holds the lease, without touching any rows', async () => {
    supabaseStub.state.rows = [{ clerk_user_id: 'user_a' }];
    mockAcquireLease.mockResolvedValue({ acquired: false, state: 'in_progress', retryAfterSeconds: 42 });

    const summary = await runSleeperRecurringBackfill(baseEnv, false);

    expect(summary.outcome).toBe('blocked');
    expect(summary.usersScanned).toBe(0);
    expect(summary.rowsProcessed).toBe(0);
    expect(mockBackfillSleeperRecurringIds).not.toHaveBeenCalled();
    // Nothing was acquired: no other holder's row must be deleted (audit
    // FLA-168 Fix 3 — blocked never deletes, since another run owns the row).
    expect(mockDeleteLeaseRow).not.toHaveBeenCalled();
    expect(summary.leaseCleanup).toBeUndefined();
  });

  // Round-4 audit finding (Fix 1b): acquireLease's default fail-open posture
  // (a storage error acquires anyway) is wrong for this single-flight guard —
  // a provider_sync_state outage must not let multiple live runs proceed
  // leaseless. The backfill opts into acquireLease's strict
  // `{ onStorageError: 'fail' }` mode, which reports the error back as
  // `{ acquired: false, state: 'error' }` instead of acquiring.
  it("returns a 'failed' outcome (not 'blocked') and touches no rows when lease acquisition fails on a storage error", async () => {
    supabaseStub.state.rows = [{ clerk_user_id: 'user_a' }];
    mockAcquireLease.mockResolvedValue({ acquired: false, state: 'error', errorMessage: 'supabase down' });

    const summary = await runSleeperRecurringBackfill(baseEnv, false);

    // Not 'blocked': that outcome carries 409 semantics ("another run holds
    // the lease"), which doesn't apply when the real problem is that
    // provider_sync_state itself couldn't be reached.
    expect(summary.outcome).toBe('failed');
    expect(summary.usersScanned).toBe(0);
    expect(summary.rowsProcessed).toBe(0);
    expect(mockBackfillSleeperRecurringIds).not.toHaveBeenCalled();
    // No lease was ever held, so nothing to clean up — same as 'blocked'.
    expect(mockDeleteLeaseRow).not.toHaveBeenCalled();
    expect(summary.leaseCleanup).toBeUndefined();
  });

  describe('lease renewal (audit FLA-168 Fix 1, time-based cadence — round-4 audit finding)', () => {
    // RENEW_INTERVAL_MS is not exported (matching this file's existing
    // convention of hardcoding BACKFILL_LEASE_TTL_MS's 15-minute value rather
    // than exporting it) — it's TTL/3.
    const RENEW_INTERVAL_MS = 5 * 60 * 1000;

    afterEach(() => {
      vi.useRealTimers();
    });

    it('renews based on elapsed wall-clock time, not on a fixed per-batch cadence', async () => {
      // BATCH_SIZE is 2, so 6 users span 3 batches. Each backfillSleeperRecurringIds
      // call advances the fake clock by 100s; two calls per batch = 200s of
      // elapsed time per batch — under RENEW_INTERVAL_MS (300s) on its own.
      vi.useFakeTimers();
      supabaseStub.state.rows = [
        { clerk_user_id: 'user_a' },
        { clerk_user_id: 'user_b' },
        { clerk_user_id: 'user_c' },
        { clerk_user_id: 'user_d' },
        { clerk_user_id: 'user_e' },
        { clerk_user_id: 'user_f' },
      ];
      mockBackfillSleeperRecurringIds.mockImplementation(async () => {
        vi.advanceTimersByTime(100_000);
        return { processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 };
      });

      const summary = await runSleeperRecurringBackfill(baseEnv, false);

      expect(summary.outcome).toBe('completed');
      // Cumulative elapsed time: 200s (batch 1, no renewal — under 300s),
      // 400s (batch 2, crosses 300s since acquire — ONE renewal), 200s more
      // since that renewal (batch 3, under 300s again — no renewal). A
      // batch-count-based cadence (the old behavior) would have called this
      // once per batch (3 times); time-based cadence calls it exactly once,
      // and specifically because of elapsed time, not because of which batch
      // just finished.
      expect(mockExtendLease).toHaveBeenCalledTimes(1);
      const [extendUserId, extendProvider, extendOwner, extendTtlMs] = mockExtendLease.mock.calls[0];
      expect(extendUserId).toBe('__backfill__');
      expect(extendProvider).toBe('sleeper');
      // Round-3 audit finding: renewal resets the same explicit 15-minute
      // window used on acquire, not sync-state.ts's 120s default.
      expect(extendTtlMs).toBe(15 * 60 * 1000);
      const [, , acquireOwner] = mockAcquireLease.mock.calls[0];
      expect(extendOwner).toBe(acquireOwner);
      // A clean finish still deletes the row.
      expect(mockDeleteLeaseRow).toHaveBeenCalledTimes(1);
    });

    it('threads a per-row renewal checkpoint into every live backfillSleeperRecurringIds call, but never for a dry run', async () => {
      supabaseStub.state.rows = [{ clerk_user_id: 'user_a' }];
      mockBackfillSleeperRecurringIds.mockResolvedValue({ processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 });

      await runSleeperRecurringBackfill(baseEnv, false);
      const [, , liveOptions] = mockBackfillSleeperRecurringIds.mock.calls[0];
      expect(typeof liveOptions.onRowCheckpoint).toBe('function');

      mockBackfillSleeperRecurringIds.mockClear();
      await runSleeperRecurringBackfill(baseEnv, true);
      const [, , dryRunOptions] = mockBackfillSleeperRecurringIds.mock.calls[0];
      expect(dryRunOptions).toEqual({ dryRun: true });
      expect(dryRunOptions.onRowCheckpoint).toBeUndefined();
    });

    // Round-3 audit finding: extendLease itself now fails CLOSED (returns
    // `false`) on a storage error rather than fail-open (see
    // sync-state.test.ts's "fails CLOSED... when storage errors" test) — from
    // this orchestrator's point of view, a real storage error and a
    // genuinely stolen lease are indistinguishable and handled identically:
    // both surface as `false` here, and both must halt the loop immediately
    // with no further writes.
    it('halts the loop with partial counts and performs no further writes when a time-based renewal fails mid-run', async () => {
      // 3 batches of 2 users each (BATCH_SIZE=2). Force every single call to
      // cross RENEW_INTERVAL_MS on its own, so the post-batch checkpoint
      // always attempts a renewal — the first attempt fails, so the second
      // and third batches must never run.
      vi.useFakeTimers();
      supabaseStub.state.rows = [
        { clerk_user_id: 'user_a' },
        { clerk_user_id: 'user_b' },
        { clerk_user_id: 'user_c' },
        { clerk_user_id: 'user_d' },
        { clerk_user_id: 'user_e' },
        { clerk_user_id: 'user_f' },
      ];
      mockBackfillSleeperRecurringIds.mockImplementation(async () => {
        vi.advanceTimersByTime(RENEW_INTERVAL_MS + 1);
        return { processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 };
      });
      mockExtendLease.mockResolvedValueOnce(false);

      const summary = await runSleeperRecurringBackfill(baseEnv, false);

      expect(summary.outcome).toBe('lease_lost');
      // Only the first batch (user_a, user_b) was processed.
      expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledTimes(2);
      expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledWith(baseEnv, 'user_a', { dryRun: false, onRowCheckpoint: expect.any(Function) });
      expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledWith(baseEnv, 'user_b', { dryRun: false, onRowCheckpoint: expect.any(Function) });
      expect(mockBackfillSleeperRecurringIds).not.toHaveBeenCalledWith(baseEnv, 'user_c', expect.anything());
      expect(summary.rowsProcessed).toBe(2);
      if (!summary.dryRun) {
        expect(summary.rowsChanged).toBe(2);
      }
      // Only one renewal attempt — the loop stopped instead of retrying or
      // continuing to the next batch.
      expect(mockExtendLease).toHaveBeenCalledTimes(1);
    });

    // Simulates a row-level checkpoint (inside the real, unmocked
    // backfillSleeperRecurringIds — see sleeper-connect-handlers.test.ts for
    // that mechanism) discovering the lease lost mid-user: the mock reports
    // `leaseLost: true` back, exactly like a real row-checkpoint failure
    // would, and the orchestrator must stop the whole run from that signal
    // alone — without waiting for its own separate post-batch checkpoint.
    it('halts immediately when a row-level checkpoint (inside backfillSleeperRecurringIds) reports leaseLost, without waiting for the post-batch check', async () => {
      supabaseStub.state.rows = [
        { clerk_user_id: 'user_a' },
        { clerk_user_id: 'user_b' },
        { clerk_user_id: 'user_c' },
        { clerk_user_id: 'user_d' },
      ];
      mockBackfillSleeperRecurringIds.mockImplementation(async (_env: unknown, userId: string) =>
        userId === 'user_a'
          ? { processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0, leaseLost: true }
          : { processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 }
      );

      const summary = await runSleeperRecurringBackfill(baseEnv, false);

      expect(summary.outcome).toBe('lease_lost');
      // Only the first batch ran; the post-batch extendLease checkpoint is
      // never even reached because the batch-level leaseLost flag short-
      // circuits before it.
      expect(mockBackfillSleeperRecurringIds).toHaveBeenCalledTimes(2);
      expect(mockBackfillSleeperRecurringIds).not.toHaveBeenCalledWith(baseEnv, 'user_c', expect.anything());
      expect(mockExtendLease).not.toHaveBeenCalled();
    });

    it('does not clobber a stolen lease when releasing (delete) after a lease_lost halt', async () => {
      vi.useFakeTimers();
      supabaseStub.state.rows = [
        { clerk_user_id: 'user_a' },
        { clerk_user_id: 'user_b' },
        { clerk_user_id: 'user_c' },
        { clerk_user_id: 'user_d' },
      ];
      mockBackfillSleeperRecurringIds.mockImplementation(async () => {
        vi.advanceTimersByTime(RENEW_INTERVAL_MS + 1);
        return { processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 };
      });
      mockExtendLease.mockResolvedValueOnce(false);

      await runSleeperRecurringBackfill(baseEnv, false);

      // finally still runs and calls deleteLeaseRow under this run's own
      // owner id; deleteLeaseRow's owner guard (tested in sync-state.test.ts)
      // is what actually prevents it from touching the new holder's row —
      // this asserts the orchestrator still issues the guarded call rather
      // than skipping it or somehow targeting a different owner.
      expect(mockDeleteLeaseRow).toHaveBeenCalledTimes(1);
      const [, , acquireOwner] = mockAcquireLease.mock.calls[0];
      const [, , deleteOwner] = mockDeleteLeaseRow.mock.calls[0];
      expect(deleteOwner).toBe(acquireOwner);
    });
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

  // Audit FLA-168 Fix 4: valid JSON that isn't an object must not be silently
  // treated as an empty (dryRun-defaulting) body.
  it('refuses a JSON null body', async () => {
    const result = await parseSleeperRecurringBackfillRequest(makeRequest('null'));
    expect(result.dryRun).toBeUndefined();
    expect(result.error?.status).toBe(400);
  });

  it('refuses a JSON array body', async () => {
    const result = await parseSleeperRecurringBackfillRequest(makeRequest('[true]'));
    expect(result.dryRun).toBeUndefined();
    expect(result.error?.status).toBe(400);
  });

  it('refuses a JSON number body', async () => {
    const result = await parseSleeperRecurringBackfillRequest(makeRequest('42'));
    expect(result.dryRun).toBeUndefined();
    expect(result.error?.status).toBe(400);
  });

  it('refuses a JSON string body', async () => {
    const result = await parseSleeperRecurringBackfillRequest(makeRequest('"false"'));
    expect(result.dryRun).toBeUndefined();
    expect(result.error?.status).toBe(400);
  });
});
