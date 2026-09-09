/**
 * Temporary, exact-cohort Yahoo recovery for FLA-355.
 *
 * The public source commits only to the SHA-256 of the 59-account manifest.
 * Each service-authenticated request supplies that complete manifest and one
 * member to process, so the endpoint cannot widen to another account.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  refreshLeaguesForUser,
  sanitizeProviderResult,
  type SanitizedProviderResult,
} from './league-refresh';

export const YAHOO_TARGETED_RECOVERY_EXPIRES_AT = '2026-09-09T12:00:00.000Z';
export const YAHOO_TARGETED_RECOVERY_MANIFEST_SIZE = 59;
export const YAHOO_TARGETED_RECOVERY_MANIFEST_HASH =
  'ee60ed4b98516e75cf3ea5a2cca227a33783cf6e061adbbc5abc4d00c00af482';
const MAX_REQUEST_BYTES = 8 * 1024;
const CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9]{20,64}$/;

export interface YahooTargetedRecoveryEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  YAHOO_CLIENT_ID?: string;
  YAHOO_CLIENT_SECRET?: string;
  ENVIRONMENT?: string;
  NODE_ENV?: string;
  FRONTEND_URL?: string;
}

export interface YahooTargetedRecoveryRequest {
  manifest: string[];
  target: string;
  dryRun: boolean;
}

interface RecoverySnapshot {
  credentialsPresent: boolean;
  leagueRows: number;
  sync: {
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastErrorCode: string | null;
    syncLeaseExpiresAt: string | null;
  };
}

/** The sanitizer now lives with the refresh result it projects. */
export type YahooTargetedRecoveryProviderResult = SanitizedProviderResult;

export type YahooTargetedRecoverySummary =
  | {
      outcome: 'expired';
      dryRun: boolean;
      expiresAt: string;
      targetIndex: number;
    }
  | {
      outcome: 'dry_run';
      dryRun: true;
      expiresAt: string;
      targetMasked: string;
      targetIndex: number;
      snapshot: RecoverySnapshot;
    }
  | {
      outcome: 'processed';
      dryRun: false;
      expiresAt: string;
      targetMasked: string;
      targetIndex: number;
      provider: YahooTargetedRecoveryProviderResult;
    }
  | {
      outcome: 'failed';
      dryRun: boolean;
      expiresAt: string;
      targetMasked: string;
      targetIndex: number;
      error: 'snapshot_failed' | 'refresh_result_missing';
    };

export type YahooTargetedRecoveryValidation =
  | { request: YahooTargetedRecoveryRequest }
  | { error: { status: 400 | 413; body: { error: string; error_description: string } } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRequest(
  error: string,
  errorDescription: string,
  status: 400 | 413 = 400
): YahooTargetedRecoveryValidation {
  return { error: { status, body: { error, error_description: errorDescription } } };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashYahooTargetedRecoveryManifest(manifest: string[]): Promise<string> {
  const canonical = [...manifest].sort().join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return bytesToHex(new Uint8Array(digest));
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function parseYahooTargetedRecoveryRequest(
  request: Request,
  expectedManifestHash = YAHOO_TARGETED_RECOVERY_MANIFEST_HASH,
  expectedManifestSize = YAHOO_TARGETED_RECOVERY_MANIFEST_SIZE
): Promise<YahooTargetedRecoveryValidation> {
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return invalidRequest('request_too_large', 'Request body exceeds 8192 bytes', 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return invalidRequest('request_too_large', 'Request body exceeds 8192 bytes', 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return invalidRequest('invalid_request', 'Request body must be valid JSON');
  }
  if (!isRecord(body)) return invalidRequest('invalid_request', 'Request body must be a JSON object');

  const allowedKeys = new Set(['manifest', 'target', 'dryRun']);
  const unknownKey = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unknownKey) return invalidRequest('invalid_request', `Unknown request field: ${unknownKey}`);
  if (!Array.isArray(body.manifest) || body.manifest.length !== expectedManifestSize) {
    return invalidRequest('invalid_manifest', `manifest must contain exactly ${expectedManifestSize} user IDs`);
  }
  if (!body.manifest.every((value): value is string =>
    typeof value === 'string' && CLERK_USER_ID_PATTERN.test(value))) {
    return invalidRequest('invalid_manifest', 'manifest contains an invalid user ID');
  }
  if (new Set(body.manifest).size !== expectedManifestSize) {
    return invalidRequest('invalid_manifest', 'manifest must contain unique user IDs');
  }
  if (typeof body.target !== 'string' || !CLERK_USER_ID_PATTERN.test(body.target)) {
    return invalidRequest('invalid_target', 'target must be a valid user ID');
  }
  if (!body.manifest.includes(body.target)) {
    return invalidRequest('invalid_target', 'target must be a member of the committed manifest');
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    return invalidRequest('invalid_dry_run', 'dryRun must be a boolean');
  }

  const actualHash = await hashYahooTargetedRecoveryManifest(body.manifest);
  if (!constantTimeStringEqual(actualHash, expectedManifestHash)) {
    return invalidRequest('invalid_manifest', 'manifest does not match the committed recovery cohort');
  }

  return {
    request: {
      manifest: body.manifest,
      target: body.target,
      dryRun: body.dryRun !== false,
    },
  };
}

function maskUserId(userId: string): string {
  return `${userId.slice(0, 8)}...`;
}

async function readSnapshot(env: YahooTargetedRecoveryEnv, target: string): Promise<RecoverySnapshot> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  return readSnapshotFromClient(supabase, target);
}

async function readSnapshotFromClient(supabase: SupabaseClient, target: string): Promise<RecoverySnapshot> {
  const [credentialResult, leagueResult, syncResult] = await Promise.all([
    supabase.from('yahoo_credentials').select('clerk_user_id').eq('clerk_user_id', target).maybeSingle(),
    supabase.from('yahoo_leagues').select('id', { count: 'exact' }).eq('clerk_user_id', target).limit(1),
    supabase
      .from('provider_sync_state')
      .select('last_attempt_at,last_success_at,last_failure_at,last_error_code,sync_lease_expires_at')
      .eq('clerk_user_id', target)
      .eq('provider', 'yahoo')
      .maybeSingle(),
  ]);
  if (credentialResult.error) throw new Error(`credential snapshot failed: ${credentialResult.error.message}`);
  if (leagueResult.error) throw new Error(`league snapshot failed: ${leagueResult.error.message}`);
  if (syncResult.error) throw new Error(`sync snapshot failed: ${syncResult.error.message}`);

  return {
    credentialsPresent: credentialResult.data !== null,
    leagueRows: leagueResult.count ?? 0,
    sync: {
      lastAttemptAt: syncResult.data?.last_attempt_at ?? null,
      lastSuccessAt: syncResult.data?.last_success_at ?? null,
      lastFailureAt: syncResult.data?.last_failure_at ?? null,
      lastErrorCode: syncResult.data?.last_error_code ?? null,
      syncLeaseExpiresAt: syncResult.data?.sync_lease_expires_at ?? null,
    },
  };
}

type YahooTargetedRecoveryDependencies = {
  now?: () => number;
  snapshot?: (env: YahooTargetedRecoveryEnv, target: string) => Promise<RecoverySnapshot>;
  refresh?: typeof refreshLeaguesForUser;
};

export async function runYahooTargetedRecovery(
  env: YahooTargetedRecoveryEnv,
  request: YahooTargetedRecoveryRequest,
  dependencies: YahooTargetedRecoveryDependencies = {}
): Promise<YahooTargetedRecoverySummary> {
  const now = dependencies.now ?? Date.now;
  const targetIndex = [...request.manifest].sort().indexOf(request.target);
  if (now() >= Date.parse(YAHOO_TARGETED_RECOVERY_EXPIRES_AT)) {
    return {
      outcome: 'expired', dryRun: request.dryRun,
      expiresAt: YAHOO_TARGETED_RECOVERY_EXPIRES_AT, targetIndex,
    };
  }

  const targetMasked = maskUserId(request.target);
  if (request.dryRun) {
    try {
      const snapshot = await (dependencies.snapshot ?? readSnapshot)(env, request.target);
      return {
        outcome: 'dry_run',
        dryRun: true,
        expiresAt: YAHOO_TARGETED_RECOVERY_EXPIRES_AT,
        targetMasked,
        targetIndex,
        snapshot,
      };
    } catch (error) {
      console.error('[yahoo-targeted-recovery] Snapshot failed:', error instanceof Error ? error.message : error);
      return {
        outcome: 'failed', dryRun: true, expiresAt: YAHOO_TARGETED_RECOVERY_EXPIRES_AT,
        targetMasked, targetIndex, error: 'snapshot_failed',
      };
    }
  }

  const refresh = dependencies.refresh ?? refreshLeaguesForUser;
  const correlationId = crypto.randomUUID();
  const result = await refresh(env, request.target, ['yahoo'], {}, correlationId, 'scheduled');
  const yahoo = result.results.yahoo;
  if (!yahoo) {
    return {
      outcome: 'failed', dryRun: false, expiresAt: YAHOO_TARGETED_RECOVERY_EXPIRES_AT,
      targetMasked, targetIndex, error: 'refresh_result_missing',
    };
  }

  const provider = sanitizeProviderResult(yahoo);
  console.log(JSON.stringify({
    event: 'yahoo_targeted_recovery',
    service: 'auth-worker',
    user_id: targetMasked,
    status: provider.status,
    http_status: provider.httpStatus,
    upstream_status: provider.upstreamStatus,
    error_code: provider.error,
    stop_reason: provider.stopReason,
    league_count: provider.leagueCount,
    correlation_id: correlationId,
  }));
  return {
    outcome: 'processed',
    dryRun: false,
    expiresAt: YAHOO_TARGETED_RECOVERY_EXPIRES_AT,
    targetMasked,
    targetIndex,
    provider,
  };
}
