import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NORMAL_REFRESH_COOLDOWN_SECONDS,
  SYNC_COOLDOWN_OWNER_PREFIX,
  SYNC_LEASE_TTL_MS,
  SyncStateStorage,
  UPSTREAM_BACKOFF_COOLDOWN_SECONDS,
} from '../sync-state';
import { allProvidersCooldownRetryAfter, cooldownSecondsForResult } from '../league-refresh';

/**
 * Chainable, thenable fake for the supabase query builder: every method
 * returns the chain, and awaiting the chain resolves to the queued result
 * for that `from()` call.
 */
function fakeSupabase(results: unknown[]) {
  const calls: Array<Record<string, unknown[][]>> = [];
  const from = vi.fn(() => {
    const result = results.shift() ?? { data: null, error: null };
    const recorded: Record<string, unknown[][]> = {};
    calls.push(recorded);
    const chain: Record<string, unknown> = {};
    for (const method of ['upsert', 'update', 'delete', 'eq', 'gt', 'or', 'is', 'select', 'single']) {
      chain[method] = vi.fn((...args: unknown[]) => {
        (recorded[method] ??= []).push(args);
        return chain;
      });
    }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, from, calls };
}

describe('SyncStateStorage.acquireLease', () => {
  it('acquires when no lease blocks and records the attempt', async () => {
    const { client, calls } = fakeSupabase([
      { error: null },                                   // upsert row-exists
      { data: [{ clerk_user_id: 'user_1' }], error: null }, // guarded update won
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('user_1', 'espn', 'owner-1');

    expect(result).toEqual({ acquired: true });
    expect(calls[1].update?.[0]?.[0]).toMatchObject({ sync_lease_owner: 'owner-1' });
    expect((calls[1].update?.[0]?.[0] as Record<string, unknown>).last_attempt_at).toBeDefined();
  });

  it('reports cooldown state and remaining seconds when blocked by a cooldown marker', async () => {
    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    const { client } = fakeSupabase([
      { error: null },              // upsert
      { data: [], error: null },    // guarded update lost
      { data: { sync_lease_owner: `${SYNC_COOLDOWN_OWNER_PREFIX}other`, sync_lease_expires_at: expiresAt }, error: null },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('user_1', 'yahoo', 'owner-2');

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.state).toBe('cooldown');
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(30);
    }
  });

  it('reports the full remaining time for cooldowns longer than the default backoff', async () => {
    const expiresAt = new Date(Date.now() + 600_000).toISOString(); // provider Retry-After of 600s
    const { client } = fakeSupabase([
      { error: null },
      { data: [], error: null },
      { data: { sync_lease_owner: `${SYNC_COOLDOWN_OWNER_PREFIX}other`, sync_lease_expires_at: expiresAt }, error: null },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('user_1', 'yahoo', 'owner-long');

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      // Must not be clamped to UPSTREAM_BACKOFF_COOLDOWN_SECONDS (PR #143 review).
      expect(result.retryAfterSeconds).toBeGreaterThan(UPSTREAM_BACKOFF_COOLDOWN_SECONDS);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(600);
    }
  });

  it('reports in_progress when blocked by a live (non-cooldown) lease', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { client } = fakeSupabase([
      { error: null },
      { data: [], error: null },
      { data: { sync_lease_owner: 'someone-else', sync_lease_expires_at: expiresAt }, error: null },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('user_1', 'sleeper', 'owner-3');

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.state).toBe('in_progress');
    }
  });

  it('fails open when storage errors so refresh availability is never blocked', async () => {
    const { client } = fakeSupabase([
      { error: new Error('supabase down') },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('user_1', 'espn', 'owner-4');

    expect(result).toEqual({ acquired: true });
  });

  // Round-4 FLA-168 audit finding: an explicit opt-in for the one caller
  // (the Sleeper recurring-id backfill) where fail-open is actively wrong.
  // Every existing caller (league-refresh.ts, index-hono.ts, reconciliation.ts)
  // calls acquireLease without a 5th argument at all, so this pins that they
  // keep the default fail-open behavior asserted above — unchanged.
  it('fails CLOSED with a distinguishable error state when { onStorageError: "fail" } is passed (round-4 audit finding)', async () => {
    const { client } = fakeSupabase([
      { error: new Error('supabase down') },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('__backfill__', 'sleeper', 'owner-1', SYNC_LEASE_TTL_MS, { onStorageError: 'fail' });

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.state).toBe('error');
      if (result.state === 'error') {
        expect(result.errorMessage).toContain('supabase down');
      }
    }
  });

  it('still acquires normally with { onStorageError: "fail" } when there is no storage error', async () => {
    const { client } = fakeSupabase([
      { error: null },
      { data: [{ clerk_user_id: '__backfill__' }], error: null },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('__backfill__', 'sleeper', 'owner-1', SYNC_LEASE_TTL_MS, { onStorageError: 'fail' });

    expect(result).toEqual({ acquired: true });
  });

  it('still reports the normal blocked (not error) state with { onStorageError: "fail" } when another owner holds the lease', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { client } = fakeSupabase([
      { error: null },
      { data: [], error: null },
      { data: { sync_lease_owner: 'someone-else', sync_lease_expires_at: expiresAt }, error: null },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('__backfill__', 'sleeper', 'owner-1', SYNC_LEASE_TTL_MS, { onStorageError: 'fail' });

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.state).toBe('in_progress');
    }
  });

  // Round-5 FLA-168 audit finding (Fix 3): the guarded update matching zero
  // rows means "someone else holds it, OR we can't tell because the
  // follow-up diagnostic read itself just failed." Before this fix, a
  // diagnostic-read failure fell through to the same handling as "no row
  // found" (`getRow` returning null), so a strict caller saw the normal
  // `'in_progress'` blocked state — and downstream, the backfill orchestrator
  // reported a 409 `'blocked'` — instead of learning that storage itself was
  // unhealthy.
  it("surfaces a failed diagnostic read as state 'error' in strict mode when the guarded update matches zero rows (round-5 audit finding, Fix 3)", async () => {
    const { client } = fakeSupabase([
      { error: null },                                    // upsert row-exists
      { data: [], error: null },                          // guarded update matched zero rows
      { data: null, error: new Error('supabase down') },  // diagnostic read itself fails
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('__backfill__', 'sleeper', 'owner-1', SYNC_LEASE_TTL_MS, { onStorageError: 'fail' });

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.state).toBe('error');
      if (result.state === 'error') {
        expect(result.errorMessage).toContain('supabase down');
      }
    }
  });

  // Pins the pre-existing default-mode (fail-open) behavior for the same
  // failure shape: every existing caller (league-refresh.ts, index-hono.ts,
  // reconciliation.ts) calls acquireLease without the 5th argument, so this
  // must stay byte-for-byte unchanged by Fix 3 — a failed diagnostic read
  // still degrades to the plain `'in_progress'` state via `getRow`'s
  // fail-to-null behavior, not `'error'`.
  it('pins legacy default-mode behavior: a failed diagnostic read still reports plain in_progress (not error), unchanged by Fix 3', async () => {
    const { client } = fakeSupabase([
      { error: null },
      { data: [], error: null },
      { data: null, error: new Error('supabase down') },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('user_1', 'espn', 'owner-1');

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.state).toBe('in_progress');
      expect(result.retryAfterSeconds).toBe(NORMAL_REFRESH_COOLDOWN_SECONDS);
    }
  });
});

// PR #206 review finding (Codex, round-6): the strict path's guarded update
// can throw AFTER the upsert already created a fresh, unowned row for
// (clerk_user_id, provider) — and the strict path then returns `state:
// 'error'` without ever setting an owner. Because the orchestrator only ever
// calls deleteLeaseRow after a *held* lease, that stranded row would
// otherwise sit in provider_sync_state forever, polluting the dashboard's
// sync_7d metric. acquireLease's strict error exits now attempt a
// best-effort, conditional cleanup DELETE scoped to `(clerk_user_id,
// provider) AND sync_lease_owner IS NULL` before returning.
describe('SyncStateStorage.acquireLease strict-mode unowned-row cleanup (PR #206 review)', () => {
  it('deletes the unowned synthetic row when the guarded update throws in strict mode, and still reports state error', async () => {
    const { client, calls } = fakeSupabase([
      { error: null },                                              // upsert row-exists
      { error: new Error('supabase down') },                        // guarded update throws
      { data: [{ clerk_user_id: '__backfill__' }], error: null },   // cleanup delete: row was unowned, deleted
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('__backfill__', 'sleeper', 'owner-1', SYNC_LEASE_TTL_MS, { onStorageError: 'fail' });

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.state).toBe('error');
      if (result.state === 'error') {
        expect(result.errorMessage).toContain('supabase down');
      }
    }

    // Cleanup delete conditionally scoped to (clerk_user_id, provider) AND
    // sync_lease_owner IS NULL — never an unconditional delete.
    expect(calls).toHaveLength(3);
    expect(calls[2].delete).toHaveLength(1);
    expect(calls[2].eq?.map((args) => args)).toContainEqual(['clerk_user_id', '__backfill__']);
    expect(calls[2].eq?.map((args) => args)).toContainEqual(['provider', 'sleeper']);
    expect(calls[2].is?.map((args) => args)).toContainEqual(['sync_lease_owner', null]);
  });

  it('does not remove a row genuinely held by another run: the conditional delete matches zero rows, and the original error is returned unchanged', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, calls } = fakeSupabase([
      { error: null },
      { error: new Error('supabase down') },
      { data: [], error: null }, // cleanup delete: sync_lease_owner IS NULL matched nothing — the row is owned
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('__backfill__', 'sleeper', 'owner-1', SYNC_LEASE_TTL_MS, { onStorageError: 'fail' });

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.state).toBe('error');
      if (result.state === 'error') {
        expect(result.errorMessage).toContain('supabase down');
      }
    }
    // Same conditional guard is used regardless of what actually happened at
    // the DB layer — it's the `IS NULL` filter, not client-side knowledge,
    // that keeps an owned row safe.
    expect(calls[2].is?.map((args) => args)).toContainEqual(['sync_lease_owner', null]);
    // A zero-row match is a clean no-op, not a cleanup failure.
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('logs a warning and still returns the original error when the cleanup delete itself fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = fakeSupabase([
      { error: null },
      { error: new Error('supabase down') },
      { error: new Error('cleanup delete failed') },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('__backfill__', 'sleeper', 'owner-1', SYNC_LEASE_TTL_MS, { onStorageError: 'fail' });

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.state).toBe('error');
      if (result.state === 'error') {
        // The ORIGINAL acquisition error, not the cleanup failure.
        expect(result.errorMessage).toContain('supabase down');
      }
    }
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[sync-state]');

    warnSpy.mockRestore();
  });

  it('also attempts cleanup when the diagnostic read itself fails (the other strict-mode error exit)', async () => {
    const { client, calls } = fakeSupabase([
      { error: null },                                             // upsert row-exists
      { data: [], error: null },                                   // guarded update matched zero rows
      { data: null, error: new Error('supabase down') },           // diagnostic read itself fails
      { data: [{ clerk_user_id: '__backfill__' }], error: null },  // cleanup delete
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('__backfill__', 'sleeper', 'owner-1', SYNC_LEASE_TTL_MS, { onStorageError: 'fail' });

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.state).toBe('error');
    }
    expect(calls).toHaveLength(4);
    expect(calls[3].delete).toHaveLength(1);
    expect(calls[3].is?.map((args) => args)).toContainEqual(['sync_lease_owner', null]);
  });

  it('never attempts cleanup for a non-synthetic clerk_user_id, even in strict mode (hard-scoped to the backfill user)', async () => {
    const { client, calls } = fakeSupabase([
      { error: null },
      { error: new Error('supabase down') },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.acquireLease('real_user_123', 'espn', 'owner-1', SYNC_LEASE_TTL_MS, { onStorageError: 'fail' });

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.state).toBe('error');
    }
    // No third `.from()` call — the hard-coded synthetic-user check short-
    // circuits before any delete is ever issued against a real user's row.
    expect(calls).toHaveLength(2);
  });
});

describe('SyncStateStorage.extendLease', () => {
  it('renews an owned lease, guarded to the current owner', async () => {
    const { client, calls } = fakeSupabase([
      { data: [{ clerk_user_id: '__backfill__' }], error: null },
    ]);
    const storage = new SyncStateStorage(client);

    const before = Date.now();
    const result = await storage.extendLease('__backfill__', 'sleeper', 'owner-1');
    const after = Date.now();

    expect(result).toBe(true);
    const update = calls[0].update?.[0]?.[0] as Record<string, unknown>;
    const expiresAtMs = new Date(update.sync_lease_expires_at as string).getTime();
    // Renewed roughly SYNC_LEASE_TTL_MS out from "now" (loose bound to avoid
    // flaking on exact timing).
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + SYNC_LEASE_TTL_MS - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + SYNC_LEASE_TTL_MS + 1000);
    // Owner guard: only the current lease holder may renew it.
    expect(calls[0].eq?.map((args) => args)).toContainEqual(['sync_lease_owner', 'owner-1']);
    expect(calls[0].gt?.[0]?.[0]).toBe('sync_lease_expires_at');
  });

  it('returns false when the lease already expired and was taken by a new owner', async () => {
    const { client } = fakeSupabase([
      { data: [], error: null }, // guarded update matched nothing — owner no longer holds it
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.extendLease('__backfill__', 'sleeper', 'owner-1');

    expect(result).toBe(false);
  });

  it('fails CLOSED (returns false) when storage errors — unlike acquireLease/settle (round-3 FLA-168 audit finding)', async () => {
    const { client } = fakeSupabase([
      { error: new Error('supabase down') },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.extendLease('__backfill__', 'sleeper', 'owner-1');

    expect(result).toBe(false);
  });
});

describe('SyncStateStorage.transferLease', () => {
  it('moves only a live exact-owner lease to the history owner', async () => {
    const { client, calls } = fakeSupabase([
      { data: [{ clerk_user_id: 'user_1' }], error: null },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.transferLease('user_1', 'espn', 'request-owner', 'history:job-1');

    expect(result).toBe(true);
    expect(calls[0].update?.[0]?.[0]).toMatchObject({ sync_lease_owner: 'history:job-1' });
    expect(calls[0].eq?.map((args) => args)).toContainEqual(['sync_lease_owner', 'request-owner']);
    expect(calls[0].gt?.[0]?.[0]).toBe('sync_lease_expires_at');
  });

  it('returns false when the owner is wrong or the lease is expired', async () => {
    const { client } = fakeSupabase([{ data: [], error: null }]);
    const storage = new SyncStateStorage(client);

    await expect(storage.transferLease('user_1', 'espn', 'wrong', 'history:job-1')).resolves.toBe(false);
  });

  it('fails closed when storage cannot prove the transfer', async () => {
    const { client } = fakeSupabase([{ error: new Error('supabase down') }]);
    const storage = new SyncStateStorage(client);

    await expect(storage.transferLease('user_1', 'espn', 'request-owner', 'history:job-1')).resolves.toBe(false);
  });
});

describe('SyncStateStorage.deleteLeaseRow', () => {
  it('deletes the owner-guarded row outright and reports success', async () => {
    const { client, calls } = fakeSupabase([
      { data: null, error: null },
    ]);
    const storage = new SyncStateStorage(client);

    const result = await storage.deleteLeaseRow('__backfill__', 'sleeper', 'owner-1');

    expect(result).toBe(true);
    expect(calls[0].delete).toHaveLength(1);
    // Owner guard: only the current lease holder's row is deleted.
    expect(calls[0].eq?.map((args) => args)).toContainEqual(['clerk_user_id', '__backfill__']);
    expect(calls[0].eq?.map((args) => args)).toContainEqual(['provider', 'sleeper']);
    expect(calls[0].eq?.map((args) => args)).toContainEqual(['sync_lease_owner', 'owner-1']);
  });

  it('reports failure instead of swallowing storage errors (round-3 FLA-168 audit finding)', async () => {
    const { client } = fakeSupabase([
      { error: new Error('supabase down') },
    ]);
    const storage = new SyncStateStorage(client);

    await expect(storage.deleteLeaseRow('__backfill__', 'sleeper', 'owner-1')).resolves.toBe(false);
  });
});

describe('SyncStateStorage.settle', () => {
  it('converts the lease to an owner-guarded cooldown marker with success telemetry', async () => {
    const { client, calls } = fakeSupabase([
      { data: [{ clerk_user_id: 'user_1' }], error: null },
    ]);
    const storage = new SyncStateStorage(client);

    await storage.settle('user_1', 'espn', 'owner-1', {
      status: 'success',
      cooldownSeconds: 75,
      syncSource: 'web',
      leagueCount: 3,
      durationMs: 1234,
    });

    const update = calls[0].update?.[0]?.[0] as Record<string, unknown>;
    expect(update.sync_lease_owner).toBe(`${SYNC_COOLDOWN_OWNER_PREFIX}owner-1`);
    expect(update.last_success_at).toBeDefined();
    expect(update.last_error_code).toBeNull();
    expect(update.last_league_count).toBe(3);
    expect(update.last_duration_ms).toBe(1234);
    expect(update.last_sync_source).toBe('web');
    // Owner guard: only the active lease holder may settle.
    expect(calls[0].eq?.map((args) => args)).toContainEqual(['sync_lease_owner', 'owner-1']);
  });

  it('records failure telemetry with a truncated error message', async () => {
    const { client, calls } = fakeSupabase([
      { data: [{ clerk_user_id: 'user_1' }], error: null },
    ]);
    const storage = new SyncStateStorage(client);

    await storage.settle('user_1', 'yahoo', 'owner-2', {
      status: 'error',
      cooldownSeconds: 300,
      syncSource: 'mcp',
      errorCode: 'discovery_failed',
      errorMessage: 'x'.repeat(600),
    });

    const update = calls[0].update?.[0]?.[0] as Record<string, unknown>;
    expect(update.last_failure_at).toBeDefined();
    expect(update.last_error_code).toBe('discovery_failed');
    expect((update.last_error_message as string).length).toBe(500);
  });

  it('releases the lease for skipped providers without touching success/failure telemetry', async () => {
    const { client, calls } = fakeSupabase([
      { data: [{ clerk_user_id: 'user_1' }], error: null },
    ]);
    const storage = new SyncStateStorage(client);

    await storage.settle('user_1', 'espn', 'owner-skip', {
      status: 'skipped',
      cooldownSeconds: 1,
      syncSource: 'web',
    });

    const update = calls[0].update?.[0]?.[0] as Record<string, unknown>;
    expect(update.sync_lease_owner).toBe(`${SYNC_COOLDOWN_OWNER_PREFIX}owner-skip`);
    // A never-attempted provider must not gain a false success timestamp,
    // and a previously recorded error must not be wiped (PR #143 review).
    expect(update).not.toHaveProperty('last_success_at');
    expect(update).not.toHaveProperty('last_failure_at');
    expect(update).not.toHaveProperty('last_error_code');
    expect(update).not.toHaveProperty('last_error_message');
  });

  it('swallows storage errors (fail open)', async () => {
    const { client } = fakeSupabase([
      { error: new Error('supabase down') },
    ]);
    const storage = new SyncStateStorage(client);

    await expect(storage.settle('user_1', 'espn', 'owner-3', {
      status: 'success',
      cooldownSeconds: 75,
      syncSource: 'web',
    })).resolves.toBeUndefined();
  });
});

describe('cooldownSecondsForResult', () => {
  it('uses the normal cooldown for plain successes and errors', () => {
    expect(cooldownSecondsForResult({ platform: 'espn', status: 'success', httpStatus: 200 }))
      .toBe(NORMAL_REFRESH_COOLDOWN_SECONDS);
    expect(cooldownSecondsForResult({ platform: 'espn', status: 'error', httpStatus: 500, error: 'discovery_failed' }))
      .toBe(NORMAL_REFRESH_COOLDOWN_SECONDS);
  });

  it('uses the upstream backoff for provider 429s', () => {
    expect(cooldownSecondsForResult({ platform: 'yahoo', status: 'error', httpStatus: 429 }))
      .toBe(UPSTREAM_BACKOFF_COOLDOWN_SECONDS);
  });

  it('honors a provider Retry-After longer than the default backoff', () => {
    expect(cooldownSecondsForResult({ platform: 'yahoo', status: 'error', httpStatus: 429, retryAfter: '600' }))
      .toBe(600);
  });

  it('classifies timeouts as upstream backoff', () => {
    expect(cooldownSecondsForResult({
      platform: 'espn',
      status: 'error',
      httpStatus: 500,
      error_description: 'ESPN discovery timed out after 30s',
    })).toBe(UPSTREAM_BACKOFF_COOLDOWN_SECONDS);
  });
});

describe('allProvidersCooldownRetryAfter', () => {
  it('returns the longest retry when every provider is cooldown-blocked', () => {
    expect(allProvidersCooldownRetryAfter({
      success: false,
      requestedPlatforms: ['espn', 'yahoo'],
      results: {
        espn: { platform: 'espn', status: 'error', httpStatus: 429, error: 'refresh_cooldown', retryAfter: '42' },
        yahoo: { platform: 'yahoo', status: 'error', httpStatus: 429, error: 'refresh_cooldown', retryAfter: '90' },
      },
    })).toBe(90);
  });

  it('returns null when any provider actually ran', () => {
    expect(allProvidersCooldownRetryAfter({
      success: true,
      requestedPlatforms: ['espn', 'sleeper'],
      results: {
        espn: { platform: 'espn', status: 'error', httpStatus: 429, error: 'refresh_cooldown', retryAfter: '42' },
        sleeper: { platform: 'sleeper', status: 'success', httpStatus: 200 },
      },
    })).toBeNull();
  });

  it('returns null for an empty result set', () => {
    expect(allProvidersCooldownRetryAfter({
      success: false,
      requestedPlatforms: [],
      results: {},
    })).toBeNull();
  });
});
