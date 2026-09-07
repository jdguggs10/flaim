/**
 * One-time Yahoo league-registry recovery (FLA-338).
 *
 * This operator-only path re-runs normal Yahoo discovery for accounts that
 * connected before the incident closed. It is temporary, handles one user per
 * request, defaults to a DB-only dry run, and reuses normal sync protections.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { YAHOO_APP_REVIEW_OUTAGE_MESSAGE } from '@flaim/worker-shared';
import { refreshLeaguesForUser, type ProviderRefreshResult } from './league-refresh';

export const YAHOO_RECOVERY_CUTOFF = '2026-09-07T11:04:00.000Z';
export const YAHOO_RECOVERY_EXPIRES_AT = '2026-09-15T04:00:00.000Z';

const MAX_CURSOR_LENGTH = 512;

export interface YahooRecoveryEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  YAHOO_CLIENT_ID?: string;
  YAHOO_CLIENT_SECRET?: string;
  ENVIRONMENT?: string;
  NODE_ENV?: string;
  FRONTEND_URL?: string;
}

export interface YahooRecoveryRequest {
  dryRun: boolean;
  cursor: string | null;
}

export interface YahooRecoveryRequestValidation {
  request?: YahooRecoveryRequest;
  error?: {
    status: 400;
    body: { error: string; error_description: string };
  };
}

interface YahooRecoveryCandidate {
  userId: string;
  createdAt: string | null;
  leagueRows: number;
  sync: {
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastErrorCode: string | null;
  };
}

interface YahooRecoveryPage {
  eligibleUsers?: number;
  candidate: YahooRecoveryCandidate | null;
  hasMore: boolean;
}

interface YahooRecoveryStorage {
  page(cutoff: string, afterUserId: string | null, includeCohortCount: boolean): Promise<YahooRecoveryPage>;
}

export interface YahooRecoveryProviderResult {
  status: 'success' | 'skipped' | 'error';
  httpStatus?: number;
  error?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  upstreamStatus?: number;
  leagueCount?: number;
  stopReason: 'provider_denied' | 'rate_limited' | null;
}

export interface YahooRecoverySummary {
  outcome: 'dry_run' | 'processed' | 'completed' | 'expired' | 'failed';
  dryRun: boolean;
  cutoff: string;
  expiresAt: string;
  cursor: string | null;
  nextCursor: string | null;
  eligibleUsers?: number;
  candidate?: {
    userIdMasked: string;
    createdAt: string | null;
    leagueRows: number;
    sync: YahooRecoveryCandidate['sync'];
  };
  provider?: YahooRecoveryProviderResult;
  error?: 'snapshot_failed' | 'refresh_result_missing';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRequest(error: string, errorDescription: string): YahooRecoveryRequestValidation {
  return { error: { status: 400, body: { error, error_description: errorDescription } } };
}

function encodeCursor(userId: string): string {
  return btoa(userId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(cursor: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > MAX_CURSOR_LENGTH) return null;
  try {
    const pad = cursor.length % 4 === 2 ? '==' : cursor.length % 4 === 3 ? '=' : '';
    const userId = atob(cursor.replace(/-/g, '+').replace(/_/g, '/') + pad);
    if (!userId || userId.length > 256 || /[^\x20-\x7E]/.test(userId)) return null;
    return userId;
  } catch {
    return null;
  }
}

export async function parseYahooRecoveryRequest(request: Request): Promise<YahooRecoveryRequestValidation> {
  const rawBody = await request.text();
  if (!rawBody.trim()) return { request: { dryRun: true, cursor: null } };

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return invalidRequest('invalid_request', 'Request body must be valid JSON');
  }
  if (!isRecord(body)) return invalidRequest('invalid_request', 'Request body must be a JSON object');

  const unknownKey = Object.keys(body).find((key) => key !== 'dryRun' && key !== 'cursor');
  if (unknownKey) return invalidRequest('invalid_request', `Unknown request field: ${unknownKey}`);
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    return invalidRequest('invalid_dry_run', 'dryRun must be a boolean');
  }
  if (body.cursor !== undefined && body.cursor !== null && typeof body.cursor !== 'string') {
    return invalidRequest('invalid_cursor', 'cursor must be the opaque string returned by the previous response');
  }
  if (typeof body.cursor === 'string' && decodeCursor(body.cursor) === null) {
    return invalidRequest('invalid_cursor', 'cursor must be the opaque string returned by the previous response');
  }

  return { request: { dryRun: body.dryRun !== false, cursor: (body.cursor as string | null | undefined) ?? null } };
}

function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.slice(0, 8)}...`;
}

function asNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function sanitizeYahooRecoveryProviderResult(result: ProviderRefreshResult): YahooRecoveryProviderResult {
  const details = isRecord(result.details) ? result.details : {};
  const upstreamStatus = asNumber(details.upstream_status);
  const retryAfterSeconds = asNumber(result.retryAfter ?? details.retry_after);
  const leagueCount = asNumber(details.count);
  const retryable = typeof details.retryable === 'boolean' ? details.retryable : undefined;
  const appDenied = upstreamStatus === 403 && result.error_description === YAHOO_APP_REVIEW_OUTAGE_MESSAGE.discovery;
  const rateLimited = upstreamStatus === 429 || upstreamStatus === 999;

  return {
    status: result.status,
    ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
    ...(leagueCount !== undefined ? { leagueCount } : {}),
    stopReason: appDenied ? 'provider_denied' : rateLimited ? 'rate_limited' : null,
  };
}

class SupabaseYahooRecoveryStorage implements YahooRecoveryStorage {
  constructor(private readonly supabase: SupabaseClient) {}

  async page(cutoff: string, afterUserId: string | null, includeCohortCount: boolean): Promise<YahooRecoveryPage> {
    let query = this.supabase
      .from('yahoo_credentials')
      .select('clerk_user_id,created_at')
      .or(`created_at.lte.${cutoff},created_at.is.null`)
      .order('clerk_user_id', { ascending: true })
      .limit(2);
    if (afterUserId) query = query.gt('clerk_user_id', afterUserId);

    const countPromise = includeCohortCount
      ? this.supabase
          .from('yahoo_credentials')
          .select('clerk_user_id', { count: 'exact', head: true })
          .or(`created_at.lte.${cutoff},created_at.is.null`)
      : Promise.resolve({ count: undefined, error: null });
    const [{ data, error }, countResult] = await Promise.all([query, countPromise]);
    if (error) throw new Error(`Yahoo recovery credential page failed: ${error.message}`);
    if (countResult.error) throw new Error(`Yahoo recovery cohort count failed: ${countResult.error.message}`);

    const rows = (data ?? []) as Array<{ clerk_user_id: string; created_at: string | null }>;
    const row = rows[0];
    if (!row) return { eligibleUsers: countResult.count ?? undefined, candidate: null, hasMore: false };

    const [leagueCountResult, syncResult] = await Promise.all([
      this.supabase
        .from('yahoo_leagues')
        .select('id', { count: 'exact', head: true })
        .eq('clerk_user_id', row.clerk_user_id),
      this.supabase
        .from('provider_sync_state')
        .select('last_attempt_at,last_success_at,last_failure_at,last_error_code')
        .eq('clerk_user_id', row.clerk_user_id)
        .eq('provider', 'yahoo')
        .maybeSingle(),
    ]);
    if (leagueCountResult.error) throw new Error(`Yahoo recovery league count failed: ${leagueCountResult.error.message}`);
    if (syncResult.error) throw new Error(`Yahoo recovery sync snapshot failed: ${syncResult.error.message}`);

    return {
      eligibleUsers: countResult.count ?? undefined,
      hasMore: rows.length > 1,
      candidate: {
        userId: row.clerk_user_id,
        createdAt: row.created_at,
        leagueRows: leagueCountResult.count ?? 0,
        sync: {
          lastAttemptAt: syncResult.data?.last_attempt_at ?? null,
          lastSuccessAt: syncResult.data?.last_success_at ?? null,
          lastFailureAt: syncResult.data?.last_failure_at ?? null,
          lastErrorCode: syncResult.data?.last_error_code ?? null,
        },
      },
    };
  }
}

type YahooRecoveryDependencies = {
  now?: () => number;
  storage?: YahooRecoveryStorage;
  refresh?: typeof refreshLeaguesForUser;
};

function baseSummary(request: YahooRecoveryRequest): Omit<YahooRecoverySummary, 'outcome'> {
  return {
    dryRun: request.dryRun,
    cutoff: YAHOO_RECOVERY_CUTOFF,
    expiresAt: YAHOO_RECOVERY_EXPIRES_AT,
    cursor: request.cursor,
    nextCursor: null,
  };
}

export async function runYahooRecovery(
  env: YahooRecoveryEnv,
  request: YahooRecoveryRequest,
  dependencies: YahooRecoveryDependencies = {}
): Promise<YahooRecoverySummary> {
  const now = dependencies.now ?? Date.now;
  if (now() >= Date.parse(YAHOO_RECOVERY_EXPIRES_AT)) {
    return { ...baseSummary(request), outcome: 'expired' };
  }

  const storage = dependencies.storage ?? new SupabaseYahooRecoveryStorage(
    createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  );
  const afterUserId = request.cursor ? decodeCursor(request.cursor) : null;

  let page: YahooRecoveryPage;
  try {
    page = await storage.page(YAHOO_RECOVERY_CUTOFF, afterUserId, request.dryRun && request.cursor === null);
  } catch (error) {
    console.error('[yahoo-recovery] Snapshot failed:', error instanceof Error ? error.message : error);
    return { ...baseSummary(request), outcome: 'failed', error: 'snapshot_failed' };
  }
  if (!page.candidate) {
    return { ...baseSummary(request), outcome: 'completed', ...(page.eligibleUsers !== undefined ? { eligibleUsers: page.eligibleUsers } : {}) };
  }

  const candidate = {
    userIdMasked: maskUserId(page.candidate.userId),
    createdAt: page.candidate.createdAt,
    leagueRows: page.candidate.leagueRows,
    sync: page.candidate.sync,
  };
  const nextCursor = page.hasMore ? encodeCursor(page.candidate.userId) : null;
  if (request.dryRun) {
    return {
      ...baseSummary(request),
      outcome: 'dry_run',
      ...(page.eligibleUsers !== undefined ? { eligibleUsers: page.eligibleUsers } : {}),
      candidate,
      nextCursor,
    };
  }

  const correlationId = crypto.randomUUID();
  const refresh = dependencies.refresh ?? refreshLeaguesForUser;
  const refreshResult = await refresh(env, page.candidate.userId, ['yahoo'], {}, correlationId, 'scheduled');
  const yahoo = refreshResult.results.yahoo;
  if (!yahoo) {
    console.error('[yahoo-recovery] Yahoo refresh returned no Yahoo result');
    return { ...baseSummary(request), outcome: 'failed', candidate, error: 'refresh_result_missing' };
  }

  const provider = sanitizeYahooRecoveryProviderResult(yahoo);
  console.log(JSON.stringify({
    event: 'yahoo_recovery_backfill',
    service: 'auth-worker',
    user_id: candidate.userIdMasked,
    status: provider.status,
    http_status: provider.httpStatus,
    upstream_status: provider.upstreamStatus,
    error_code: provider.error,
    stop_reason: provider.stopReason,
    league_count: provider.leagueCount,
    correlation_id: correlationId,
  }));

  return { ...baseSummary(request), outcome: 'processed', candidate, provider, nextCursor };
}
