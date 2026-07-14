import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  NORMAL_REFRESH_COOLDOWN_SECONDS,
  SYNC_COOLDOWN_OWNER_PREFIX,
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
    for (const method of ['upsert', 'update', 'eq', 'or', 'select', 'single']) {
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
