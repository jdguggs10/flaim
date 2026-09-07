#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, rm, writeFile, chmod, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RECOVERY_CUTOFF = '2026-09-07T11:04:00.000Z';
export const RECOVERY_EXPIRES_AT = '2026-09-15T04:00:00.000Z';
export const DEFAULT_PACE_MS = 2_000;
export const SYSTEMIC_FAILURE_LIMIT = 2;
export const ENDPOINTS = Object.freeze({
  preview: 'https://auth-worker-preview.gerrygugger.workers.dev/internal/backfill/yahoo-recovery',
  prod: 'https://auth-worker.gerrygugger.workers.dev/internal/backfill/yahoo-recovery',
});

const OUTCOMES = new Set(['dry_run', 'processed', 'completed', 'expired', 'failed']);
const RESOLUTIONS = new Set(['processed', 'retry']);

function usage(message) {
  const help = `Usage:
  yahoo-recovery.mjs --env preview|prod --checkpoint PATH --dry-run [--max-users N] [--cursor OPAQUE_CURSOR] [--cutoff ${RECOVERY_CUTOFF}]
  yahoo-recovery.mjs --env preview|prod --checkpoint PATH --canary [--cursor OPAQUE_CURSOR] [--cutoff ${RECOVERY_CUTOFF}]
  yahoo-recovery.mjs --env preview|prod --checkpoint PATH --apply --max-users N [--cursor OPAQUE_CURSOR] [--cutoff ${RECOVERY_CUTOFF}]
  yahoo-recovery.mjs --env preview|prod --checkpoint PATH --reconcile [--break-lock]
  yahoo-recovery.mjs --env preview|prod --checkpoint PATH --resolve-uncertain processed|retry [--break-lock]

The internal service token is read once from stdin for every network command.
Apply is serial, one user per request, with a ${DEFAULT_PACE_MS}ms default pause after each response.`;
  throw new Error(message ? `${message}\n\n${help}` : help);
}

function integer(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!/^\d+$/.test(value ?? '')) usage(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    usage(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

export function isValidOpaqueCursor(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 ||
      value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length > 0 && decoded.length <= 256 && decoded.every(byte => byte >= 0x20 && byte <= 0x7e);
  } catch {
    return false;
  }
}

export function parseArgs(argv) {
  const options = { paceMs: DEFAULT_PACE_MS, cursor: null, cutoff: RECOVERY_CUTOFF, breakLock: false };
  let modeCount = 0;
  const setMode = mode => {
    options.mode = mode;
    modeCount += 1;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') setMode('dry-run');
    else if (arg === '--canary') setMode('canary');
    else if (arg === '--apply') setMode('apply');
    else if (arg === '--reconcile') setMode('reconcile');
    else if (arg === '--break-lock') options.breakLock = true;
    else if (arg === '--env') options.environment = argv[++i];
    else if (arg === '--checkpoint') options.checkpointPath = resolve(argv[++i] ?? '');
    else if (arg === '--cursor') {
      options.cursor = argv[++i];
      if (!isValidOpaqueCursor(options.cursor)) usage('--cursor must be a valid opaque cursor returned by the endpoint');
    }
    else if (arg === '--cutoff') options.cutoff = argv[++i];
    else if (arg === '--max-users') options.maxUsers = integer(argv[++i], '--max-users', { min: 1, max: 2_000 });
    else if (arg === '--pace-ms') options.paceMs = integer(argv[++i], '--pace-ms', { min: 1_000, max: 60_000 });
    else if (arg === '--resolve-uncertain') {
      setMode('resolve');
      options.resolution = argv[++i];
    } else if (arg === '--help' || arg === '-h') usage();
    else usage(`Unknown argument: ${arg}`);
  }

  if (!ENDPOINTS[options.environment]) usage('--env must be preview or prod');
  if (!options.checkpointPath) usage('--checkpoint is required');
  if (modeCount !== 1) usage('Choose exactly one mode');
  if (options.cutoff !== RECOVERY_CUTOFF) usage(`--cutoff must equal the fixed recovery cutoff ${RECOVERY_CUTOFF}`);
  if (options.mode === 'canary') options.maxUsers = 1;
  if (options.mode === 'apply' && !options.maxUsers) usage('--apply requires an explicit --max-users');
  if (options.mode === 'dry-run') options.maxUsers ??= 1;
  if (options.mode === 'reconcile') options.maxUsers = 1;
  if (options.mode === 'resolve' && !RESOLUTIONS.has(options.resolution)) {
    usage('--resolve-uncertain must be processed or retry');
  }
  if (options.breakLock && !['reconcile', 'resolve'].includes(options.mode)) {
    usage('--break-lock is allowed only for reconciliation commands');
  }
  return options;
}

export async function readTokenFromStdin(stream = process.stdin) {
  let token = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) token += chunk;
  token = token.trim();
  if (!token || /\s/.test(token)) throw new Error('stdin must contain exactly one non-whitespace service token');
  return token;
}

function initialCheckpoint(options, now) {
  return {
    version: 1,
    environment: options.environment,
    endpoint: ENDPOINTS[options.environment],
    cutoff: RECOVERY_CUTOFF,
    expiresAt: RECOVERY_EXPIRES_AT,
    cursor: options.cursor,
    completed: false,
    createdAt: now(),
    updatedAt: now(),
    totals: { attempted: 0, succeeded: 0, failed: 0 },
    deferred: [],
    uncertain: null,
    reconciliation: null,
    lastResult: null,
  };
}

export async function readCheckpoint(path, options, deps = {}) {
  const read = deps.readFile ?? readFile;
  try {
    const checkpoint = JSON.parse(await read(path, 'utf8'));
    if (checkpoint.version !== 1 || checkpoint.environment !== options.environment ||
        checkpoint.endpoint !== ENDPOINTS[options.environment] || checkpoint.cutoff !== RECOVERY_CUTOFF ||
        checkpoint.expiresAt !== RECOVERY_EXPIRES_AT ||
        !(checkpoint.cursor === null || isValidOpaqueCursor(checkpoint.cursor)) ||
        (checkpoint.uncertain && !(checkpoint.uncertain.cursor === null || isValidOpaqueCursor(checkpoint.uncertain.cursor))) ||
        !checkpoint.totals || !Number.isSafeInteger(checkpoint.totals.attempted) ||
        !Number.isSafeInteger(checkpoint.totals.succeeded) || !Number.isSafeInteger(checkpoint.totals.failed) ||
        !Array.isArray(checkpoint.deferred)) {
      throw new Error('checkpoint does not match this runner, environment, or fixed cutoff');
    }
    return checkpoint;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return initialCheckpoint(options, deps.now ?? (() => new Date().toISOString()));
  }
}

export async function writeCheckpoint(path, checkpoint, deps = {}) {
  const makeDir = deps.mkdir ?? mkdir;
  const write = deps.writeFile ?? writeFile;
  const move = deps.rename ?? rename;
  const setMode = deps.chmod ?? chmod;
  await makeDir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await write(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await setMode(temporary, 0o600);
  await move(temporary, path);
  await setMode(path, 0o600);
}

export async function acquireLock(checkpointPath, { breakLock = false } = {}, deps = {}) {
  const lockPath = `${checkpointPath}.lock`;
  const remove = deps.rm ?? rm;
  const openFile = deps.open ?? open;
  const makeDir = deps.mkdir ?? mkdir;
  await makeDir(dirname(lockPath), { recursive: true });
  if (breakLock) await remove(lockPath, { force: true });
  let handle;
  try {
    handle = await openFile(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === 'EEXIST') throw new Error(`exclusive lock exists: ${lockPath}`);
    throw error;
  }
  return async () => {
    await handle.close();
    await remove(lockPath, { force: true });
  };
}

function numberOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function validateResponse(raw, expectedCursor, expectedDryRun) {
  if (!raw || typeof raw !== 'object' || !OUTCOMES.has(raw.outcome) || raw.dryRun !== expectedDryRun ||
      raw.cutoff !== RECOVERY_CUTOFF || raw.expiresAt !== RECOVERY_EXPIRES_AT ||
      (raw.cursor ?? null) !== expectedCursor) {
    throw new Error('endpoint returned an invalid recovery envelope');
  }
  const nextCursor = raw.nextCursor == null ? null : raw.nextCursor;
  if (nextCursor !== null && !isValidOpaqueCursor(nextCursor)) {
    throw new Error('endpoint returned an invalid nextCursor');
  }
  if (nextCursor !== null && nextCursor === expectedCursor) {
    throw new Error('endpoint nextCursor did not advance');
  }
  const candidate = raw.candidate && typeof raw.candidate === 'object' ? {
    userIdMasked: stringOrNull(raw.candidate.userIdMasked),
    createdAt: stringOrNull(raw.candidate.createdAt),
    leagueRows: numberOrNull(raw.candidate.leagueRows),
    sync: raw.candidate.sync && typeof raw.candidate.sync === 'object' ? {
      lastAttemptAt: stringOrNull(raw.candidate.sync.lastAttemptAt),
      lastSuccessAt: stringOrNull(raw.candidate.sync.lastSuccessAt),
      lastFailureAt: stringOrNull(raw.candidate.sync.lastFailureAt),
      lastErrorCode: stringOrNull(raw.candidate.sync.lastErrorCode),
    } : null,
  } : null;
  const provider = raw.provider && typeof raw.provider === 'object' ? {
    status: stringOrNull(raw.provider.status),
    httpStatus: numberOrNull(raw.provider.httpStatus),
    error: stringOrNull(raw.provider.error),
    retryAfterSeconds: numberOrNull(raw.provider.retryAfterSeconds),
    upstreamStatus: numberOrNull(raw.provider.upstreamStatus),
    leagueCount: numberOrNull(raw.provider.leagueCount),
    stopReason: stringOrNull(raw.provider.stopReason),
  } : null;
  if (raw.candidate && (!candidate?.userIdMasked || candidate.leagueRows === null || !candidate.sync)) {
    throw new Error('endpoint returned an invalid recovery candidate');
  }
  if (raw.provider && (!provider?.status || !['success', 'skipped', 'error'].includes(provider.status))) {
    throw new Error('endpoint returned an invalid provider result');
  }
  const eligibleUsers = raw.eligibleUsers === undefined ? null : numberOrNull(raw.eligibleUsers);
  if (raw.eligibleUsers !== undefined && eligibleUsers === null) {
    throw new Error('endpoint returned an invalid eligibleUsers count');
  }
  return {
    outcome: raw.outcome,
    dryRun: raw.dryRun,
    cutoff: raw.cutoff,
    expiresAt: raw.expiresAt,
    cursor: raw.cursor,
    nextCursor,
    eligibleUsers,
    candidate,
    provider,
  };
}

export function consoleCandidate(candidate) {
  const masked = candidate?.userIdMasked;
  if (!masked) return 'candidate';
  return `candidate-${createHash('sha256').update(masked).digest('hex').slice(0, 8)}`;
}

export function consoleCursor(cursor) {
  return cursor === null ? 'start' : createHash('sha256').update(cursor).digest('hex').slice(0, 8);
}

export function classifyResult(result, httpStatus, consecutiveSystemicFailures) {
  if (httpStatus === 410 || result.outcome === 'expired') return { stop: true, reason: 'expired', systemic: 0 };
  if (httpStatus === 429 || result.provider?.stopReason === 'rate_limited') {
    return { stop: true, reason: 'rate_limited', systemic: 0 };
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return { stop: true, reason: `endpoint_http_${httpStatus}`, systemic: 0 };
  }
  if (result.provider?.stopReason === 'provider_denied') {
    return { stop: true, reason: 'provider_denied', systemic: 0 };
  }
  const systemic = httpStatus >= 500 || (result.provider?.httpStatus ?? 0) >= 500;
  const nextSystemic = systemic ? consecutiveSystemicFailures + 1 : 0;
  if (nextSystemic >= SYSTEMIC_FAILURE_LIMIT) return { stop: true, reason: 'systemic_failure', systemic: nextSystemic };
  if (result.outcome === 'failed') return { stop: true, reason: 'endpoint_failed', systemic: nextSystemic };
  const completed = result.outcome === 'completed' || result.nextCursor === null;
  return { stop: completed, reason: completed ? 'completed' : null, systemic: nextSystemic };
}

async function callEndpoint({ endpoint, token, dryRun, cursor, fetchImpl }) {
  const body = { dryRun };
  if (cursor !== null) body.cursor = cursor;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'X-Flaim-Internal-Token': token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(75_000),
  });
  let raw;
  try {
    raw = await response.json();
  } catch {
    throw new Error(`endpoint returned non-JSON HTTP ${response.status}`);
  }
  return { result: validateResponse(raw, cursor, dryRun), httpStatus: response.status };
}

export async function reconcileUncertain(options, token, deps = {}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const checkpoint = await readCheckpoint(options.checkpointPath, options, deps);
  if (!checkpoint.uncertain) throw new Error('checkpoint has no uncertain apply attempt');
  const { result } = await callEndpoint({
    endpoint: ENDPOINTS[options.environment], token, dryRun: true,
    cursor: checkpoint.uncertain.cursor, fetchImpl: deps.fetch ?? fetch,
  });
  checkpoint.reconciliation = { observedAt: now(), attemptStartedAt: checkpoint.uncertain.startedAt, result };
  checkpoint.updatedAt = now();
  await writeCheckpoint(options.checkpointPath, checkpoint, deps);
  return checkpoint;
}

export async function resolveUncertain(options, deps = {}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const checkpoint = await readCheckpoint(options.checkpointPath, options, deps);
  if (!checkpoint.uncertain) throw new Error('checkpoint has no uncertain apply attempt');
  if (!checkpoint.reconciliation || checkpoint.reconciliation.attemptStartedAt !== checkpoint.uncertain.startedAt) {
    throw new Error('run --reconcile before resolving an uncertain attempt');
  }
  if (options.resolution === 'processed') {
    const reconciledNext = checkpoint.reconciliation.result?.nextCursor;
    if (reconciledNext) checkpoint.cursor = reconciledNext;
    else checkpoint.completed = true;
  }
  checkpoint.lastResolution = { resolution: options.resolution, resolvedAt: now(), cursor: checkpoint.uncertain.cursor };
  checkpoint.uncertain = null;
  checkpoint.reconciliation = null;
  checkpoint.updatedAt = now();
  await writeCheckpoint(options.checkpointPath, checkpoint, deps);
  return checkpoint;
}

export async function runBatch(options, token, deps = {}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const sleep = deps.sleep ?? (ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms)));
  const fetchImpl = deps.fetch ?? fetch;
  const log = deps.log ?? console.log;
  const checkpoint = await readCheckpoint(options.checkpointPath, options, deps);
  if (checkpoint.uncertain) throw new Error('uncertain apply attempt exists; run --reconcile, then --resolve-uncertain');
  if (checkpoint.completed) throw new Error('checkpoint is already complete');

  const apply = options.mode === 'apply' || options.mode === 'canary';
  let scanCursor = apply ? checkpoint.cursor : options.cursor;
  let processed = 0;
  let systemic = 0;
  while (processed < options.maxUsers) {
    const cursor = scanCursor;
    if (apply) {
      checkpoint.uncertain = { id: randomUUID(), cursor, startedAt: now(), mode: options.mode };
      checkpoint.reconciliation = null;
      checkpoint.updatedAt = now();
      await writeCheckpoint(options.checkpointPath, checkpoint, deps);
    }

    let response;
    try {
      response = await callEndpoint({
        endpoint: ENDPOINTS[options.environment], token, dryRun: !apply, cursor, fetchImpl,
      });
    } catch (error) {
      if (!apply) {
        checkpoint.lastResult = { cursor, stoppedAt: now(), reason: 'request_failed' };
        checkpoint.updatedAt = now();
        await writeCheckpoint(options.checkpointPath, checkpoint, deps);
      }
      throw error;
    }

    const { result, httpStatus } = response;
    processed += result.candidate ? 1 : 0;

    const classification = classifyResult(result, httpStatus, systemic);
    systemic = classification.systemic;
    if (apply) {
      checkpoint.uncertain = null;
      checkpoint.reconciliation = null;
      checkpoint.lastResult = result;
      checkpoint.totals.attempted += result.candidate ? 1 : 0;
      if (result.provider?.status === 'success') checkpoint.totals.succeeded += 1;
      else if (result.candidate && result.provider?.status !== 'skipped') {
        checkpoint.totals.failed += 1;
        checkpoint.deferred.push({
          cursor,
          nextCursor: result.nextCursor,
          attemptedAt: now(),
          error: result.provider?.error ?? result.outcome,
          httpStatus: result.provider?.httpStatus ?? httpStatus,
        });
      }
      if (result.nextCursor !== null) checkpoint.cursor = result.nextCursor;
      checkpoint.completed = classification.reason === 'completed' || classification.reason === 'expired';
      checkpoint.stopReason = classification.reason;
      scanCursor = checkpoint.cursor;
    } else {
      checkpoint.lastDryRun = { observedAt: now(), result };
      scanCursor = result.nextCursor;
    }
    checkpoint.updatedAt = now();
    await writeCheckpoint(options.checkpointPath, checkpoint, deps);

    log(`${apply ? options.mode : 'dry-run'} cursor=${consoleCursor(cursor)} ${consoleCandidate(result.candidate)} outcome=${result.outcome} provider=${result.provider?.status ?? 'none'}`);
    if (classification.stop || !result.candidate) break;
    if (processed < options.maxUsers) await sleep(options.paceMs);
  }
  return checkpoint;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const release = await acquireLock(options.checkpointPath, { breakLock: options.breakLock }, deps);
  try {
    if (options.mode === 'resolve') {
      const checkpoint = await resolveUncertain(options, deps);
      console.log(`uncertain cursor resolved as ${options.resolution}; next cursor=${consoleCursor(checkpoint.cursor)}`);
      return;
    }
    const token = await readTokenFromStdin(deps.stdin ?? process.stdin);
    if (options.mode === 'reconcile') {
      const checkpoint = await reconcileUncertain(options, token, deps);
      const sync = checkpoint.reconciliation?.result?.candidate?.sync;
      console.log(`reconciliation recorded; attempt=${checkpoint.uncertain.startedAt} lastAttempt=${sync?.lastAttemptAt ?? 'none'} lastSuccess=${sync?.lastSuccessAt ?? 'none'} lastFailure=${sync?.lastFailureAt ?? 'none'}`);
      console.log('Inspect this evidence, then run --resolve-uncertain processed|retry.');
      return;
    }
    const checkpoint = await runBatch(options, token, deps);
    if (options.mode === 'dry-run') {
      console.log(`dry-run stopped after at most ${options.maxUsers} candidates; apply cursor and totals unchanged`);
    } else {
      console.log(`stopped cursor=${consoleCursor(checkpoint.cursor)} attempted=${checkpoint.totals.attempted} succeeded=${checkpoint.totals.succeeded} failed=${checkpoint.totals.failed} deferred=${checkpoint.deferred.length} reason=${checkpoint.stopReason ?? 'max_users'}`);
    }
  } finally {
    await release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Yahoo recovery stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
