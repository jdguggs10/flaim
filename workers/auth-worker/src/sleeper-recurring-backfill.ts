/**
 * One-off backfill orchestrator for Sleeper `recurring_league_id` (FLA-168).
 * ---------------------------------------------------------------------------
 *
 * Finds distinct users with at least one `sleeper_leagues` row missing
 * `recurring_league_id`, then re-runs backfillSleeperRecurringIds's full
 * previous_league_id chain walk for each — resolving the canonical root
 * rather than the cheap `= league_id` shortcut applied at write time before
 * this migration.
 *
 * Default is dry-run: the internal route below requires an explicit
 * `dryRun: false` to perform writes. Every run emits structured
 * `sleeper_recurring_backfill` JSON log lines, mirroring reconciliation.ts's
 * `league_reconciliation` event style.
 *
 * Concurrency: live (dryRun:false) runs single-flight via the same
 * provider_sync_state lease machinery used for per-user provider syncs
 * (sync-state.ts), keyed on a reserved pseudo-user id rather than a real
 * clerk_user_id. This is a global lock across all users being backfilled in
 * one run — adequate because this route is an operator-triggered one-off,
 * not a per-user user-facing action. A second concurrent live run gets a 409
 * instead of racing writes against the first. Dry runs are read-only and
 * skip the guard entirely (audit FLA-168 Fix 5).
 *
 * The lease is acquired with an explicit 15-minute TTL (BACKFILL_LEASE_TTL_MS,
 * below) rather than the 120s SYNC_LEASE_TTL_MS sized for a single provider
 * refresh — a whole backfill run's initial snapshot read, or even one slow
 * user batch, can plausibly exceed 120s on its own. Acquisition itself opts
 * into `acquireLease`'s `{ onStorageError: 'fail' }` mode (round-4 audit
 * finding): every OTHER caller of acquireLease fails OPEN on a storage error
 * (refresh availability matters more than cooldown enforcement for a
 * per-user action), but that posture is wrong here — a provider_sync_state
 * outage failing open would let multiple live backfill runs proceed
 * leaseless and race writes against each other. A storage-error acquisition
 * failure here returns outcome 'failed' (not 'blocked' — 'blocked' means
 * another run genuinely holds the lease) and never touches a row.
 *
 * HONEST INVARIANT (round-5 audit finding — read this before changing
 * anything lease-related below): the lease is NOT what makes concurrent
 * writes safe. That job belongs entirely to the persistence path —
 * `SleeperStorage.backfillRecurringLeagueId` is a conditional `UPDATE`
 * scoped to one exact `(clerk_user_id, league_id, season_year)` row, guarded
 * on `recurring_league_id IS NULL`, and two independent runs resolving the
 * same recurring chain always compute the same deterministic root — so even
 * a genuine overlap between two live runs (lease bug, clock skew, whatever)
 * can race a write, but it can never corrupt data: the second writer's
 * conditional UPDATE either sets the same value the first one did or matches
 * zero rows because the first one already got there. That's the correctness
 * backstop, unconditionally, lease or no lease. What the lease actually does
 * is bound DUPLICATE WORK: without it, two live runs would each burn a full
 * table scan and a full chain-walk pass redoing (mostly) the same rows for
 * no benefit. So the goal below is narrower than "no overlap can ever
 * happen" — it's "once this run has DETECTED that it may have lost the
 * lease, it stops issuing new writes promptly," which is a much cheaper
 * property to actually guarantee than hard mutual exclusion would be.
 *
 * Once acquired, the lease is renewed on a TIME-based cadence, not a
 * batch-count-based one (round-4 audit finding replacing round 3's
 * once-per-batch renewal): per-user work is unbounded relative to the TTL,
 * since one user's rows are processed sequentially and each row's own
 * previous_league_id chain walk can itself make up to MAX_HISTORY_YEARS (5)
 * Sleeper requests at a 10s timeout apiece — enough rows/chains under a single
 * user could exceed the old once-per-batch renewal's 15-minute window well
 * before the next batch boundary ever arrives. `createLeaseRenewer` below
 * tracks `lastRenewedAt` and only actually calls `extendLease` once
 * RENEW_INTERVAL_MS (BACKFILL_LEASE_TTL_MS / 3 = 5 minutes) has elapsed since
 * the last successful renewal, so the same checkpoint function is cheap to
 * call frequently: after every keyset snapshot page, before EVERY row AND
 * again immediately before that row's persist call (round-5 audit finding,
 * Fix 1a — not just once per user, and not just once per row either;
 * threaded into backfillSleeperRecurringIds as `onRowCheckpoint`,
 * sleeper-connect-handlers.ts), and after every batch. The invariant this
 * preserves: checkpoint spacing must stay well under BACKFILL_LEASE_TTL_MS,
 * so the worst-case gap between real renewals is one row's chain walk (~5 x
 * 10s plus DB writes), not an entire user's or an entire batch's worth of
 * unbounded work — and because the checkpoint is re-consulted right before
 * the write itself, not only before the (possibly slow) work leading up to
 * it, "no further writes once loss is detected" holds at WRITE granularity:
 * a row whose chain walk started under a valid-looking lease still gets
 * fenced at the last possible moment if the lease was lost mid-walk.
 *
 * Concurrent checkpoint calls from different batch lanes are single-flighted
 * (round-5 audit finding, Fix 1b): `createLeaseRenewer` only issues one
 * `extendLease` request at a time — a second lane whose own checkpoint call
 * lands while a renewal is already in flight awaits that SAME promise
 * instead of racing a redundant `extendLease` call, which would otherwise
 * let one call latch `lost` while a second, now-pointless in-flight call
 * still reports success. Renewal is fail-closed: if the (single-flighted)
 * `extendLease` call returns false OR the underlying storage call itself
 * fails (sync-state.ts's extendLease reports storage errors as failure here,
 * unlike its other, fail-open siblings — round-3 audit finding), every
 * subsequent checkpoint (including one already queued behind the same
 * in-flight promise) also reports lost without re-attempting the network
 * call, and the run stops issuing new writes at its very next checkpoint,
 * returning a `lease_lost` outcome with whatever partial counts it
 * completed. This backfill is idempotent and resumable (re-running it only
 * ever touches rows still NULL), so aborting on uncertain lease ownership is
 * safe — and, per the correctness backstop above, so is NOT aborting
 * instantly; the point of stopping promptly is to bound wasted work, not to
 * prevent corruption that the conditional write already rules out. On a
 * normal finish, the synthetic lease row is deleted outright rather than
 * released back to an unheld state (audit FLA-168 Fix 3) — it has no real
 * user's telemetry worth keeping, and a leftover row would otherwise sit in
 * provider_sync_state indefinitely, inflating sync_7d.users_attempted and
 * risking a phantom Sleeper entry in sync_recent. The row is still visible
 * for the run's own (manual, minutes-long) duration, which is acceptable.
 * That cleanup delete can itself fail; its result is now reported back as
 * `leaseCleanup` in the response and a console.warn on failure (round-3 audit
 * finding), without changing the run's own outcome.
 *
 * Renewal cadence is measured from a pre-request clock base, not from when
 * the renewal request resolves (round-5 audit finding, Fix 2): sync-state.ts
 * computes the STORED `sync_lease_expires_at` from a `Date.now()` taken
 * before its own awaited Supabase call (both in `acquireLease` and
 * `extendLease`), so this file's in-memory cadence tracking has to be
 * measured from that same pre-request side of the await — otherwise a slow
 * renewal request (there is no configured DB timeout) shifts the in-memory
 * "when is the next renewal due" base later than the stored expiry's own
 * base, opening a window where the row has already expired in storage but
 * this checkpoint still thinks it isn't due for renewal yet. See
 * `createLeaseRenewer`'s `t0` and this file's `acquireStartedAt` below.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { backfillSleeperRecurringIds, type SleeperConnectEnv } from './sleeper-connect-handlers';
import { SyncStateStorage, type SyncProvider, type LeaseRenewalCheckpoint } from './sync-state';

export type SleeperRecurringBackfillEnv = SleeperConnectEnv;

const SNAPSHOT_PAGE_SIZE = 1000;
const BATCH_SIZE = 2;

// Synthetic (clerk_user_id, provider) key for the backfill's single-flight
// lease. No schema change needed: provider_sync_state's primary key is
// (clerk_user_id, provider) with no FK to a real users table, and 'sleeper'
// already satisfies its provider check constraint.
const BACKFILL_LEASE_USER_ID = '__backfill__';
const BACKFILL_LEASE_PROVIDER: SyncProvider = 'sleeper';
const BACKFILL_LEASE_OWNER_PREFIX = 'sleeper-recurring-backfill:';

// Explicit long TTL for the backfill's lease (round-3 audit finding) —
// deliberately independent of sync-state.ts's SYNC_LEASE_TTL_MS (120s), which
// is sized for a single provider refresh, not a whole bulk backfill run. Used
// for both the initial acquire and every renewal below.
const BACKFILL_LEASE_TTL_MS = 15 * 60 * 1000;

// Renewal cadence (round-4 audit finding, replacing round 3's once-per-batch
// renewal): TTL/3 = 5 minutes. INVARIANT — every checkpoint that calls
// maybeRenewLease() (snapshot page, per-row, post-batch) must be spaced well
// under BACKFILL_LEASE_TTL_MS so a slow stretch of work between two
// checkpoints can never itself exceed the TTL. A single previous_league_id
// chain walk (the slowest unit of work between two per-row checkpoints) is at
// most MAX_HISTORY_YEARS Sleeper requests at a 10s timeout each — well under
// 5 minutes even in the worst case.
const RENEW_INTERVAL_MS = BACKFILL_LEASE_TTL_MS / 3;

/**
 * Tracks when the backfill's lease was last renewed and exposes a single
 * `maybeRenewLease()` checkpoint that every call site (snapshot pagination,
 * per-row, pre-persist, post-batch) shares. No-ops (returns true without a
 * network call) unless RENEW_INTERVAL_MS has elapsed since the last
 * successful renewal — cheap enough to call before every single row, and
 * again immediately before that row's write.
 *
 * `initialRenewedAt` (Fix 2, round-5 audit finding) is the cadence's starting
 * base and must be a `now()` timestamp captured by the CALLER before it ever
 * called `acquireLease` — not one captured here, after acquisition has
 * already completed. `sync-state.ts`'s `acquireLease` computes the row's
 * stored `sync_lease_expires_at` from a `Date.now()` taken before its own
 * awaited Supabase calls; starting this renewer's cadence from a timestamp
 * captured AFTER `acquireLease` resolves would already be running behind
 * that stored expiry by however long acquisition itself took.
 *
 * Single-flighted (Fix 1b, round-5 audit finding): concurrent checkpoint
 * calls from different batch lanes can both observe RENEW_INTERVAL_MS as
 * elapsed at (effectively) the same time. Without single-flighting, both
 * would issue their own `extendLease` call — a plainly wasted duplicate
 * request, and worse, a genuine race: one call's fail-closed failure could
 * latch `lost` while the OTHER, now-redundant in-flight call still resolves
 * `true`, and whichever settles last wins even though it says nothing new.
 * `inFlight` fixes this: the first caller to find renewal due starts the
 * request and stores its promise; every other caller that arrives while it's
 * still pending (as `now() - lastRenewedAt` remains "due" for them too, since
 * `lastRenewedAt` isn't updated until the in-flight call resolves) awaits
 * that SAME promise instead of starting a second request, so every lane sees
 * one consistent outcome and `extendLease` is called at most once per actual
 * renewal.
 *
 * Once a renewal attempt fails (extendLease returns false, whether from a
 * stolen lease or its own fail-closed storage-error handling), `lost`
 * latches permanently: every later call — including one already waiting on
 * the same in-flight promise, or a concurrently-arriving checkpoint for a
 * different user in the same batch — returns false, so the whole run
 * converges on stopping new writes at its very next checkpoint rather than
 * some callers proceeding past a lease that is already gone. This bounds
 * DUPLICATE WORK once loss is suspected; it is not what makes an overlapping
 * write safe — see this file's top doc comment for why that's the
 * conditional-write persistence path's job, not this checkpoint's.
 */
function createLeaseRenewer(
  syncState: SyncStateStorage,
  leaseOwner: string,
  initialRenewedAt: number,
  now: () => number = Date.now
): LeaseRenewalCheckpoint {
  let lastRenewedAt = initialRenewedAt;
  let lost = false;
  let inFlight: Promise<boolean> | null = null;

  return async () => {
    if (lost) return false;
    if (now() - lastRenewedAt < RENEW_INTERVAL_MS) return true;

    if (!inFlight) {
      // t0 (Fix 2, round-5 audit finding) is captured BEFORE issuing the
      // request, mirroring how sync-state.ts computes the stored expiry
      // before its own awaited call — so a slow renewal round-trip (no
      // configured DB timeout) shifts this cadence's base later exactly as
      // much as it would shift the stored expiry, never more. Using the
      // completion time instead would let a slow request silently push the
      // NEXT renewal's due time later than the row's real remaining TTL.
      const t0 = now();
      inFlight = (async () => {
        const stillHeld = await syncState.extendLease(
          BACKFILL_LEASE_USER_ID,
          BACKFILL_LEASE_PROVIDER,
          leaseOwner,
          BACKFILL_LEASE_TTL_MS
        );
        if (stillHeld) {
          lastRenewedAt = t0;
        } else {
          lost = true;
        }
        return stillHeld;
      })().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}

function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

function logBackfill(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: 'sleeper_recurring_backfill', service: 'auth-worker', ...fields }));
}

/**
 * Distinct clerk_user_ids with at least one sleeper_leagues row where
 * recurring_league_id IS NULL. Selects only the clerk_user_id column and
 * pages through results — the full table is never loaded, matching
 * fetchProviderSnapshot's select-only, paginated approach in reconciliation.ts.
 *
 * Paginated by keyset on clerk_user_id (`clerk_user_id > lastSeen`), NOT
 * numeric offset (round-3 audit finding). This scan filters on
 * `recurring_league_id IS NULL`, and concurrent normal sync can fill that
 * column for earlier rows while this scan is still paging. Offset pagination
 * is defined by position in the current result set, so removing rows ahead of
 * an unfetched page shifts every later row backward — the next `.range()`
 * call then lands on the wrong slice and a contiguous block of users at the
 * tail is silently skipped. A keyset cursor has no such dependency on
 * position: each page asks for "clerk_user_id strictly greater than the last
 * one seen," which stays correct regardless of what happened to earlier rows.
 * A single user can still contribute rows across a page boundary; skipping
 * that user's remaining rows once its id has already been recorded in
 * `userIds` is fine, since only set membership (not per-row detail) is needed
 * here — the row-level data is re-read fresh per user inside
 * backfillSleeperRecurringIds.
 *
 * `leaseRenewer` (round-4 audit finding), when provided, is checked after
 * EVERY page fetch — including the last one — so a run whose snapshot alone
 * takes a while (a very large table, many pages) still renews on the same
 * cadence as the rest of the run. A `false` return stops paging immediately;
 * `leaseLost: true` on the result tells the caller to skip the whole batch
 * loop rather than process a snapshot gathered under a lease that's already
 * gone.
 */
async function fetchUsersMissingRecurringId(
  supabase: SupabaseClient,
  leaseRenewer: LeaseRenewalCheckpoint | null
): Promise<{ userIds: string[]; leaseLost: boolean }> {
  const userIds = new Set<string>();
  let lastUserId: string | null = null;
  let leaseLost = false;

  for (;;) {
    // All filter calls (.is(), .gt()) happen before any transform call
    // (.order(), .limit()) so `query`'s type never narrows away from
    // PostgrestFilterBuilder (which is what .gt() requires) partway through
    // — reassigning `query` after an .order()/.limit() call would lose the
    // ability to conditionally add a further filter.
    let query = supabase
      .from('sleeper_leagues')
      .select('clerk_user_id')
      .is('recurring_league_id', null);
    if (lastUserId !== null) {
      query = query.gt('clerk_user_id', lastUserId);
    }

    const { data, error } = await query
      .order('clerk_user_id', { ascending: true })
      .limit(SNAPSHOT_PAGE_SIZE);
    if (error) throw new Error(`sleeper_leagues snapshot query failed: ${error.message}`);

    const page = (data ?? []) as unknown as Array<{ clerk_user_id: string }>;
    for (const row of page) userIds.add(row.clerk_user_id);

    // Checkpoint (i), round-4 audit finding: renew after every page fetch,
    // including the last one before this loop breaks — a large table can
    // page for a while on its own.
    if (leaseRenewer) {
      const stillHeld = await leaseRenewer();
      if (!stillHeld) {
        leaseLost = true;
        break;
      }
    }

    if (page.length < SNAPSHOT_PAGE_SIZE) break;
    lastUserId = page[page.length - 1].clerk_user_id;
  }
  return { userIds: Array.from(userIds), leaseLost };
}

// 'lease_lost' = the lease was renewed after a batch and had already expired
// and been re-acquired by a new run (audit FLA-168 Fix 1) — processing stops
// immediately and the summary carries whatever was completed so far.
export type SleeperRecurringBackfillOutcome = 'completed' | 'failed' | 'blocked' | 'lease_lost';

export type SleeperRecurringBackfillSummary =
  | {
      outcome: SleeperRecurringBackfillOutcome;
      dryRun: true;
      usersScanned: number;
      rowsProcessed: number;
      rowsResolved: number;
      rowsUnresolved: number;
      rowsWouldChange: number;
      /** Always 0 for a dry run — no write is ever attempted. */
      rowsSkippedConcurrent: number;
      errors: number;
      /** Present only when a live lease-holding run reached its cleanup step (never for dry runs or a 'blocked' outcome). */
      leaseCleanup?: 'ok' | 'failed';
    }
  | {
      outcome: SleeperRecurringBackfillOutcome;
      dryRun: false;
      usersScanned: number;
      rowsProcessed: number;
      rowsResolved: number;
      rowsUnresolved: number;
      rowsChanged: number;
      /**
       * Rows whose conditional write matched zero rows (round-3 audit
       * finding) — deleted, or already filled by a concurrent normal sync,
       * between the per-user snapshot read and the write. A clean skip, not
       * an error.
       */
      rowsSkippedConcurrent: number;
      errors: number;
      /** Present only when this run held the lease and reached its cleanup step (never for a 'blocked' outcome). */
      leaseCleanup?: 'ok' | 'failed';
    };

export async function runSleeperRecurringBackfill(
  env: SleeperRecurringBackfillEnv,
  dryRun: boolean
): Promise<SleeperRecurringBackfillSummary> {
  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  const leaseOwner = `${BACKFILL_LEASE_OWNER_PREFIX}${runId}`;

  let outcome: SleeperRecurringBackfillOutcome = 'completed';
  let usersScanned = 0;
  let rowsProcessed = 0;
  let rowsResolved = 0;
  let rowsUnresolved = 0;
  let rowsChanged = 0;
  let rowsSkippedConcurrent = 0;
  let errors = 0;
  let retryAfterSeconds: number | undefined;
  let leaseCleanup: 'ok' | 'failed' | undefined;

  const logLeaseLost = () => logBackfill({
    run_id: runId,
    status: 'lease_lost',
    dry_run: dryRun,
    users_scanned: usersScanned,
    rows_processed: rowsProcessed,
    rows_resolved: rowsResolved,
    rows_unresolved: rowsUnresolved,
    rows_changed: rowsChanged,
    rows_skipped_concurrent: rowsSkippedConcurrent,
  });

  logBackfill({ run_id: runId, status: 'run_start', dry_run: dryRun });

  // Single-flight guard for live runs only (audit FLA-168 Fix 5): dry runs
  // never write, so two concurrent dry runs can't race anything. Explicit
  // 15-minute TTL (round-3 audit finding) — see BACKFILL_LEASE_TTL_MS above.
  // `{ onStorageError: 'fail' }` (round-4 audit finding) opts this call out of
  // acquireLease's default fail-open posture — see the file doc comment above
  // for why fail-open is wrong specifically for this single-flight guard.
  const syncState = dryRun ? null : SyncStateStorage.fromEnvironment(env);
  // Captured BEFORE calling acquireLease (Fix 2, round-5 audit finding), not
  // after it resolves — this is the cadence base createLeaseRenewer starts
  // from below, and it must sit on the same pre-request side of the await as
  // the stored lease row's own expiry (sync-state.ts computes that from a
  // Date.now() taken before ITS awaited Supabase calls too).
  const acquireStartedAt = Date.now();
  const lease = syncState
    ? await syncState.acquireLease(BACKFILL_LEASE_USER_ID, BACKFILL_LEASE_PROVIDER, leaseOwner, BACKFILL_LEASE_TTL_MS, { onStorageError: 'fail' })
    : null;

  if (lease && !lease.acquired && lease.state === 'error') {
    // A provider_sync_state storage error during acquisition, not a lease
    // genuinely held by another run — 'failed', not 'blocked', since
    // 'blocked' carries 409 semantics ("another run holds the lease") that
    // don't apply when we don't actually know who (if anyone) holds it.
    outcome = 'failed';
    console.error(
      `[sleeper-recurring-backfill] Lease acquisition failed (storage error) for run ${runId}; refusing to run leaseless: ${lease.errorMessage}`
    );
    logBackfill({ run_id: runId, status: 'failed', dry_run: dryRun, reason: 'lease_acquire_error', error: lease.errorMessage });
  } else if (lease && !lease.acquired) {
    outcome = 'blocked';
    retryAfterSeconds = lease.retryAfterSeconds;
    logBackfill({ run_id: runId, status: 'blocked', dry_run: dryRun, retry_after: retryAfterSeconds });
  } else {
    // Shared time-based renewal checkpoint (round-4 audit finding) — see
    // createLeaseRenewer and the file doc comment above. `null` for dry runs
    // (no lease held, so `syncState` is null); threaded into the snapshot
    // scan, every row inside backfillSleeperRecurringIds, and the post-batch
    // check below, all through this single instance so `lost` latches once
    // for the whole run regardless of which checkpoint discovers it.
    const leaseRenewer = syncState ? createLeaseRenewer(syncState, leaseOwner, acquireStartedAt) : null;

    try {
      const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false },
      });
      const { userIds, leaseLost: snapshotLeaseLost } = await fetchUsersMissingRecurringId(supabase, leaseRenewer);
      usersScanned = userIds.length;

      if (snapshotLeaseLost) {
        // Lost before a single user was even attempted — skip the batch loop
        // entirely rather than process a snapshot gathered under a lease
        // that's already gone.
        outcome = 'lease_lost';
        logLeaseLost();
      } else {
        for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
          const batch = userIds.slice(i, i + BATCH_SIZE);
          let batchLeaseLost = false;
          // Isolate per-user failures: an unexpected throw for one user must not
          // abandon the rest of the batch, mirroring runReconciliation's
          // candidate isolation in reconciliation.ts.
          await Promise.all(
            batch.map(async (userId) => {
              try {
                const result = await backfillSleeperRecurringIds(env, userId, {
                  dryRun,
                  // Checkpoint (ii), round-4 audit finding: renews before EACH
                  // row inside backfillSleeperRecurringIds, not once per user —
                  // see that function's doc comment for why.
                  ...(leaseRenewer ? { onRowCheckpoint: leaseRenewer } : {}),
                });
                rowsProcessed += result.processed;
                rowsResolved += result.resolved;
                rowsUnresolved += result.unresolved;
                rowsChanged += result.changed;
                rowsSkippedConcurrent += result.skippedConcurrent;
                if (result.leaseLost) batchLeaseLost = true;
                logBackfill({
                  run_id: runId,
                  status: 'user_processed',
                  user_id: maskUserId(userId),
                  processed: result.processed,
                  resolved: result.resolved,
                  unresolved: result.unresolved,
                  changed: result.changed,
                  skipped_concurrent: result.skippedConcurrent,
                });
              } catch (error) {
                errors++;
                logBackfill({ run_id: runId, status: 'user_failed', user_id: maskUserId(userId) });
                console.error(
                  `[sleeper-recurring-backfill] Failed for user ${maskUserId(userId)}:`,
                  error instanceof Error ? error.message : error
                );
              }
            })
          );

          if (batchLeaseLost) {
            // A row-level checkpoint inside backfillSleeperRecurringIds
            // already found the lease gone for one or more users in this
            // batch (round-4 audit finding) — stop immediately rather than
            // starting the next batch under a lease that's already lost.
            outcome = 'lease_lost';
            logLeaseLost();
            break;
          }

          // Post-batch checkpoint, routed through the same time-based helper
          // (round-4 audit finding, replacing round 3's unconditional
          // once-per-batch extendLease call): a no-op unless RENEW_INTERVAL_MS
          // has actually elapsed since the last renewal, so this no longer
          // forces a network round-trip on every single batch. A `false`
          // return — whether because the lease already expired and was
          // re-acquired by another run, OR because the underlying storage
          // call itself failed (extendLease reports storage errors as
          // failure, not success, specifically for this caller — round-3
          // audit finding) — means ownership is no longer certain, so this
          // run stops issuing new writes at the next batch boundary rather
          // than risk piling up more duplicate work against a new holder
          // (the conditional write itself, not this stop, is what actually
          // rules out corruption — see the file doc comment). Fail-closed,
          // not a throw: this backfill is idempotent and resumable, so a
          // `lease_lost` outcome with partial counts is safe; finishing
          // 'completed' under unknown ownership would not be.
          if (leaseRenewer) {
            const stillHeld = await leaseRenewer();
            if (!stillHeld) {
              outcome = 'lease_lost';
              logLeaseLost();
              break;
            }
          }
        }
      }
    } catch (error) {
      outcome = 'failed';
      console.error('[sleeper-recurring-backfill] Run failed:', error instanceof Error ? error.message : error);
    } finally {
      if (syncState) {
        // Delete rather than release (audit FLA-168 Fix 3): this row's
        // (clerk_user_id, provider) key is the synthetic '__backfill__'/
        // 'sleeper' pseudo-user, not a real refresh target, so nothing should
        // persist here between runs — a leftover row would inflate
        // sync_7d.users_attempted and could phantom a Sleeper provider entry
        // in sync_recent. The row IS visible for this run's own duration
        // (this route is a manual, operator-triggered, minutes-long
        // one-off — that transient visibility is acceptable). Owner-guarded
        // exactly like release() was, so if the lease was already stolen
        // (the lease_lost path above), this deletes zero rows rather than
        // clobbering the new holder's row.
        //
        // deleteLeaseRow now reports its own storage failures back (round-3
        // audit finding) instead of swallowing them: a failed cleanup leaves
        // the synthetic row polluting dashboard sync metrics, so it's worth a
        // warning and a flag on the response — but it must not change this
        // run's own outcome, which already reflects what happened to the
        // actual rows being backfilled.
        const cleanedUp = await syncState.deleteLeaseRow(BACKFILL_LEASE_USER_ID, BACKFILL_LEASE_PROVIDER, leaseOwner);
        leaseCleanup = cleanedUp ? 'ok' : 'failed';
        if (!cleanedUp) {
          console.warn(
            `[sleeper-recurring-backfill] Failed to delete backfill lease row for run ${runId}; the synthetic '__backfill__' row may still be present in provider_sync_state.`
          );
        }
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  logBackfill({
    run_id: runId,
    status: 'run_end',
    outcome,
    dry_run: dryRun,
    users_scanned: usersScanned,
    rows_processed: rowsProcessed,
    rows_resolved: rowsResolved,
    rows_unresolved: rowsUnresolved,
    ...(dryRun ? { rows_would_change: rowsChanged } : { rows_changed: rowsChanged }),
    rows_skipped_concurrent: rowsSkippedConcurrent,
    errors,
    duration_ms: durationMs,
    ...(retryAfterSeconds !== undefined ? { retry_after: retryAfterSeconds } : {}),
    ...(leaseCleanup !== undefined ? { lease_cleanup: leaseCleanup } : {}),
  });

  return dryRun
    ? { outcome, dryRun: true, usersScanned, rowsProcessed, rowsResolved, rowsUnresolved, rowsWouldChange: rowsChanged, rowsSkippedConcurrent, errors, ...(leaseCleanup !== undefined ? { leaseCleanup } : {}) }
    : { outcome, dryRun: false, usersScanned, rowsProcessed, rowsResolved, rowsUnresolved, rowsChanged, rowsSkippedConcurrent, errors, ...(leaseCleanup !== undefined ? { leaseCleanup } : {}) };
}

// =============================================================================
// REQUEST PARSING (refuse-don't-fallback on malformed bodies, mirroring
// parseReconciliationConfig / parseLeagueRefreshRequest)
// =============================================================================

export interface BackfillRequestValidation {
  dryRun?: boolean;
  error?: {
    status: 400;
    body: {
      error: string;
      error_description: string;
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Body is `{ dryRun?: boolean }`; missing/absent dryRun defaults to true. */
export async function parseSleeperRecurringBackfillRequest(request: Request): Promise<BackfillRequestValidation> {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return { dryRun: true };
  }

  let body: unknown;
  try {
    // JSON.parse is last-wins on duplicate keys (e.g. `{"dryRun":true,"dryRun":false}`
    // parses as `{ dryRun: false }`) — there is no raw-text duplicate-key
    // detection here (audit FLA-168 Fix 4). Accepted: this route is
    // internal-token-gated (requireInternalService, index-hono.ts), not
    // reachable by an untrusted caller who'd have a reason to smuggle a
    // second key past a naive reviewer of the request body.
    body = JSON.parse(rawBody);
  } catch {
    return {
      error: {
        status: 400,
        body: { error: 'invalid_request', error_description: 'Request body must be valid JSON' },
      },
    };
  }

  if (!isRecord(body)) {
    return {
      error: {
        status: 400,
        body: { error: 'invalid_request', error_description: 'Request body must be a JSON object' },
      },
    };
  }

  if (body.dryRun === undefined) {
    return { dryRun: true };
  }

  if (typeof body.dryRun !== 'boolean') {
    return {
      error: {
        status: 400,
        body: { error: 'invalid_dry_run', error_description: 'dryRun must be a boolean' },
      },
    };
  }

  return { dryRun: body.dryRun };
}
