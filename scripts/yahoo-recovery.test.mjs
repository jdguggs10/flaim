import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  ENDPOINTS,
  RECOVERY_CUTOFF,
  RECOVERY_EXPIRES_AT,
  acquireLock,
  parseArgs,
  readTokenFromStdin,
  reconcileUncertain,
  resolveUncertain,
  runBatch,
} from './yahoo-recovery.mjs';

function options(path, overrides = {}) {
  return {
    environment: 'preview', checkpointPath: path, cutoff: RECOVERY_CUTOFF,
    cursor: null, maxUsers: 2, paceMs: 2_000, mode: 'dry-run', breakLock: false,
    ...overrides,
  };
}

function envelope(cursor, overrides = {}) {
  const sequence = cursor === null ? 1 : Number(cursor.split('-').at(-1)) + 1;
  return {
    outcome: 'dry_run', dryRun: true, cutoff: RECOVERY_CUTOFF,
    expiresAt: RECOVERY_EXPIRES_AT, cursor, nextCursor: `cursor-${sequence}`,
    ...(cursor === null ? { eligibleUsers: 10 } : {}),
    candidate: { userIdMasked: 'user_abc...', createdAt: '2026-01-01T00:00:00Z', leagueRows: 0, sync: {} },
    ...overrides,
  };
}

async function temporaryCheckpoint() {
  const directory = await mkdtemp(join(tmpdir(), 'flaim-yahoo-recovery-'));
  return join(directory, 'checkpoint.json');
}

test('CLI fixes hosts and cutoff and bounds apply', () => {
  const parsed = parseArgs(['--env', 'prod', '--checkpoint', '/tmp/recovery.json', '--apply', '--max-users', '25']);
  assert.equal(parsed.environment, 'prod');
  assert.equal(parsed.cutoff, RECOVERY_CUTOFF);
  assert.equal(parsed.maxUsers, 25);
  assert.equal(ENDPOINTS.prod, 'https://auth-worker.gerrygugger.workers.dev/internal/backfill/yahoo-recovery');
  assert.throws(() => parseArgs(['--env', 'prod', '--checkpoint', '/tmp/x', '--apply']), /max-users/);
  assert.throws(() => parseArgs(['--env', 'prod', '--checkpoint', '/tmp/x', '--dry-run', '--apply', '--max-users', '1']), /exactly one mode/);
  assert.throws(() => parseArgs(['--env', 'prod', '--checkpoint', '/tmp/x', '--dry-run', '--cutoff', '2026-09-08T00:00:00Z']), /fixed recovery cutoff/);
});

test('token is read from stdin once and rejects multiple fields', async () => {
  assert.equal(await readTokenFromStdin(Readable.from(['secret-token\n'])), 'secret-token');
  await assert.rejects(readTokenFromStdin(Readable.from(['one two\n'])), /exactly one/);
});

test('dry-run is serial and paces only between completed requests', async () => {
  const path = await temporaryCheckpoint();
  const calls = [];
  const sleeps = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, token: init.headers['X-Flaim-Internal-Token'] });
    return Response.json(envelope(body.cursor ?? null));
  };
  const checkpoint = await runBatch(options(path), 'token', {
    fetch, sleep: async ms => sleeps.push(ms), log: () => {},
  });
  assert.deepEqual(calls.map(call => call.body), [{ dryRun: true }, { dryRun: true, cursor: 'cursor-1' }]);
  assert.deepEqual(sleeps, [2_000]);
  assert.equal(checkpoint.cursor, null);
  assert.equal(checkpoint.totals.attempted, 0);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('dry-run followed by canary starts at the unchanged apply cursor', async () => {
  const path = await temporaryCheckpoint();
  const bodies = [];
  const fetch = async (_url, init) => {
    assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body);
    bodies.push(body);
    return Response.json(envelope(body.cursor ?? null, body.dryRun ? {} : {
      outcome: 'processed', dryRun: false, provider: { status: 'success', httpStatus: 200, stopReason: null },
    }));
  };
  await runBatch(options(path, { mode: 'dry-run', maxUsers: 2 }), 'token', { fetch, sleep: async () => {}, log: () => {} });
  const checkpoint = await runBatch(options(path, { mode: 'canary', maxUsers: 1 }), 'token', { fetch, log: () => {} });
  assert.deepEqual(bodies, [
    { dryRun: true },
    { dryRun: true, cursor: 'cursor-1' },
    { dryRun: false },
  ]);
  assert.equal(checkpoint.cursor, 'cursor-1');
  assert.equal(checkpoint.totals.attempted, 1);
});

test('a successful final candidate with null nextCursor completes without restarting the cohort', async () => {
  const path = await temporaryCheckpoint();
  let calls = 0;
  const checkpoint = await runBatch(options(path, { mode: 'apply', maxUsers: 5 }), 'token', {
    fetch: async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      return Response.json(envelope(body.cursor ?? null, {
        outcome: 'processed', dryRun: false, nextCursor: null,
        provider: { status: 'success', httpStatus: 200, stopReason: null },
      }));
    }, sleep: async () => {}, log: () => {},
  });
  assert.equal(calls, 1);
  assert.equal(checkpoint.completed, true);
  assert.equal(checkpoint.stopReason, 'completed');
  assert.equal(checkpoint.totals.attempted, 1);
  assert.equal(checkpoint.totals.succeeded, 1);
});

test('apply persists uncertain attempt before network and leaves it on transport failure', async () => {
  const path = await temporaryCheckpoint();
  let observed;
  const fetch = async () => {
    observed = JSON.parse(await readFile(path, 'utf8'));
    throw new Error('socket closed');
  };
  await assert.rejects(runBatch(options(path, { mode: 'apply', maxUsers: 1 }), 'token', { fetch, log: () => {} }), /socket closed/);
  assert.equal(observed.uncertain.cursor, null);
  const after = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(after.uncertain.cursor, null);
  await assert.rejects(runBatch(options(path, { mode: 'apply', maxUsers: 1 }), 'token', { fetch, log: () => {} }), /uncertain apply/);
});

test('uncertain apply requires dry-run reconciliation before explicit resolution', async () => {
  const path = await temporaryCheckpoint();
  await assert.rejects(runBatch(options(path, { mode: 'apply', maxUsers: 1 }), 'token', {
    fetch: async () => { throw new Error('lost response'); }, log: () => {},
  }));
  await assert.rejects(resolveUncertain(options(path, { mode: 'resolve', resolution: 'retry' })), /--reconcile/);

  await reconcileUncertain(options(path, { mode: 'reconcile' }), 'token', {
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.deepEqual(body, { dryRun: true });
      return Response.json(envelope(null, {
        candidate: { userIdMasked: 'masked', createdAt: '2026-01-01T00:00:00Z', leagueRows: 2,
          sync: { lastAttemptAt: '2026-09-07T12:00:00Z', lastSuccessAt: '2026-09-07T12:00:01Z' } },
      }));
    },
  });
  const resolved = await resolveUncertain(options(path, { mode: 'resolve', resolution: 'processed' }));
  assert.equal(resolved.cursor, 'cursor-1');
  assert.equal(resolved.uncertain, null);
});

test('provider denial and upstream rate limit stop the fleet immediately', async () => {
  for (const [stopReason, status] of [['provider_denied', 403], ['rate_limited', 429]]) {
    const path = await temporaryCheckpoint();
    let calls = 0;
    const checkpoint = await runBatch(options(path, { mode: 'apply', maxUsers: 5 }), 'token', {
      fetch: async (_url, init) => {
        calls += 1;
        const { cursor } = JSON.parse(init.body);
        return Response.json(envelope(cursor ?? null, {
          outcome: 'processed', dryRun: false,
          provider: { status: 'error', httpStatus: status, stopReason },
        }));
      }, sleep: async () => {}, log: () => {},
    });
    assert.equal(calls, 1);
    assert.equal(checkpoint.stopReason, stopReason);
  }
});

test('two consecutive systemic provider failures stop, while one advances', async () => {
  const path = await temporaryCheckpoint();
  let calls = 0;
  const checkpoint = await runBatch(options(path, { mode: 'apply', maxUsers: 5 }), 'token', {
    fetch: async (_url, init) => {
      calls += 1;
      const { cursor } = JSON.parse(init.body);
      return Response.json(envelope(cursor ?? null, {
        outcome: 'processed', dryRun: false,
        provider: { status: 'error', httpStatus: 503, stopReason: null },
      }));
    }, sleep: async () => {}, log: () => {},
  });
  assert.equal(calls, 2);
  assert.equal(checkpoint.stopReason, 'systemic_failure');
  assert.equal(checkpoint.deferred.length, 2);
});

test('an endpoint snapshot failure stops without advancing the cursor', async () => {
  const path = await temporaryCheckpoint();
  const checkpoint = await runBatch(options(path, { mode: 'dry-run', maxUsers: 5 }), 'token', {
    fetch: async () => Response.json(envelope(null, {
      outcome: 'failed', nextCursor: null, candidate: undefined, error: 'snapshot_failed',
    })),
    sleep: async () => {}, log: () => {},
  });
  assert.equal(checkpoint.cursor, null);
  assert.equal(checkpoint.lastDryRun.result.outcome, 'failed');
});

test('checkpoint lock is exclusive', async () => {
  const path = await temporaryCheckpoint();
  const release = await acquireLock(path);
  await assert.rejects(acquireLock(path), /exclusive lock exists/);
  await release();
  const releaseAgain = await acquireLock(path);
  await releaseAgain();
});
