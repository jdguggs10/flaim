/**
 * Operator support diagnostics for a single Yahoo-connected account (FLA-360).
 *
 * These routes are the only ones that take their target user id from the request
 * body, so the request shape is validated strictly: a fixed key set, a hard byte
 * cap, and a Clerk user-id pattern.
 *
 * `runYahooSupportInspect` is strictly read-only: it reads stored state and
 * projects a redacted snapshot. It never renews a credential, never touches sync
 * state, and never writes leagues — see the non-goal tests that pin each of
 * those. Diagnose and refresh land in later changes.
 *
 * Redaction is enforced at the query, not the response: every read names its
 * columns explicitly, so a customer league key, league name, team name, or a
 * token can never enter this module's memory in the first place.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  readYahooCredentialHealthReport,
  type YahooCredentialHealthReport,
} from './yahoo-connect-handlers';

export const CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9]{20,64}$/;

// Duplicated locally rather than imported from yahoo-targeted-recovery.ts (a
// temporary FLA-355 module already past its expiry and slated for removal) or
// from any other of the ~13 modules that already carry their own private copy
// — that duplication is this codebase's existing convention for a one-line
// helper, not something worth a new shared package to avoid.
function maskUserId(userId: string): string {
  return `${userId.slice(0, 8)}...`;
}
const MAX_REQUEST_BYTES = 1024;
/**
 * Hard ceiling on Yahoo round trips a single diagnose call may make. Exported
 * now so the diagnostic implementation and its tests share one budget constant.
 */
export const MAX_YAHOO_DIAGNOSTIC_REQUESTS = 2;

export interface YahooSupportEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  YAHOO_CLIENT_ID?: string;
  YAHOO_CLIENT_SECRET?: string;
  ENVIRONMENT?: string;
  NODE_ENV?: string;
  FRONTEND_URL?: string;
}

export interface YahooSupportRequest {
  userId: string;
}

export type YahooSupportValidation =
  | { request: YahooSupportRequest }
  | { error: { status: 400 | 413; body: { error: string; error_description: string } } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRequest(
  error: string,
  errorDescription: string,
  status: 400 | 413 = 400
): YahooSupportValidation {
  return { error: { status, body: { error, error_description: errorDescription } } };
}

export async function parseYahooSupportRequest(request: Request): Promise<YahooSupportValidation> {
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return invalidRequest('request_too_large', `Request body exceeds ${MAX_REQUEST_BYTES} bytes`, 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return invalidRequest('request_too_large', `Request body exceeds ${MAX_REQUEST_BYTES} bytes`, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return invalidRequest('invalid_request', 'Request body must be valid JSON');
  }
  if (!isRecord(body)) return invalidRequest('invalid_request', 'Request body must be a JSON object');

  const allowedKeys = new Set(['userId']);
  const unknownKey = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unknownKey) return invalidRequest('invalid_request', `Unknown request field: ${unknownKey}`);

  if (typeof body.userId !== 'string' || !CLERK_USER_ID_PATTERN.test(body.userId)) {
    return invalidRequest('invalid_user_id', 'userId must be a valid user ID');
  }

  return { request: { userId: body.userId } };
}

// =============================================================================
// INSPECT — read-only account snapshot
// =============================================================================

/**
 * Per-provider sync state. `sync_lease_owner` is deliberately absent (raw owner
 * ids are never exposed), and so is `last_error_message`: it is written from
 * `ProviderRefreshResult.error_description`, which is free-form and can carry a
 * thrown `Error.message` — including a Postgres constraint-violation message
 * naming the conflicting `league_key`/`season_year`. `last_error_code` is a
 * closed set of internal codes and is safe.
 */
export interface YahooSupportSyncSnapshot {
  provider: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
  lastLeagueCount: number | null;
  lastDurationMs: number | null;
  lastSyncSource: string | null;
  syncLeaseExpiresAt: string | null;
}

export interface YahooSupportLeagueSnapshot {
  rowCount: number;
  distinctSeasons: number;
  oldestUpdatedAt: string | null;
  newestUpdatedAt: string | null;
}

export interface YahooSupportSessionSnapshot {
  activeCount: number;
  mostRecentExpiresAt: string | null;
  clientNames: string[];
}

export type YahooSupportInspectReport =
  | {
      outcome: 'ok';
      userMasked: string;
      checkedAt: string;
      providers: { yahoo: boolean; espn: boolean; sleeper: boolean };
      yahooCredential: YahooCredentialHealthReport | { connected: false; hasCredentials: false };
      yahooLeagues: YahooSupportLeagueSnapshot;
      sync: YahooSupportSyncSnapshot[];
      flaimSessions: YahooSupportSessionSnapshot;
    }
  | { outcome: 'failed'; userMasked: string; error: 'snapshot_failed' };

export type YahooSupportInspectDependencies = {
  now?: () => number;
  supabase?: SupabaseClient;
  credentialHealth?: typeof readYahooCredentialHealthReport;
};

type SupabaseReadResult = { error: unknown; data: unknown; count?: number | null };

/**
 * Supabase reads report failure in the result rather than by throwing. Convert
 * to a throw so one `catch` covers every read, and never fold the driver's
 * message into anything the caller sees: a read that fails mid-statement can
 * echo row values.
 */
function unwrapRead<T extends SupabaseReadResult>(result: T, label: string): T {
  if (result.error) {
    const code = (result.error as { code?: string })?.code ?? 'unknown';
    throw new Error(`${label} read failed (code=${code})`);
  }
  return result;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Extremes by parsed instant, returning the stored strings untouched. */
function timestampRange(values: Array<string | null>): { oldest: string | null; newest: string | null } {
  let oldest: string | null = null;
  let newest: string | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;
  let newestMs = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (value === null) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    if (ms < oldestMs) {
      oldestMs = ms;
      oldest = value;
    }
    if (ms > newestMs) {
      newestMs = ms;
      newest = value;
    }
  }

  return { oldest, newest };
}

/**
 * Read-only support snapshot for one account.
 *
 * Every Supabase read below names its columns explicitly. Do not replace any of
 * them with `select('*')` or with a storage-class helper that does: the
 * redaction guarantee this endpoint makes to customers is a property of these
 * column lists, and the tests assert on them.
 */
export async function runYahooSupportInspect(
  env: YahooSupportEnv,
  request: YahooSupportRequest,
  dependencies: YahooSupportInspectDependencies = {}
): Promise<YahooSupportInspectReport> {
  const now = dependencies.now ?? Date.now;
  const credentialHealth = dependencies.credentialHealth ?? readYahooCredentialHealthReport;
  const userMasked = maskUserId(request.userId);
  const correlationId = crypto.randomUUID();
  const checkedAtDate = new Date(now());
  const checkedAt = checkedAtDate.toISOString();

  let report: YahooSupportInspectReport;
  try {
    const supabase =
      dependencies.supabase ??
      createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

    const [yahooPresent, espnPresent, sleeperPresent, leagues, sync, sessions, credential] =
      await Promise.all([
        supabase.from('yahoo_credentials').select('clerk_user_id').eq('clerk_user_id', request.userId).limit(1),
        supabase.from('espn_credentials').select('clerk_user_id').eq('clerk_user_id', request.userId).limit(1),
        supabase.from('sleeper_connections').select('clerk_user_id').eq('clerk_user_id', request.userId).limit(1),
        // Never league_key / league_name / team_name / team_key.
        supabase
          .from('yahoo_leagues')
          .select('season_year,updated_at', { count: 'exact' })
          .eq('clerk_user_id', request.userId),
        supabase
          .from('provider_sync_state')
          .select(
            'provider,last_attempt_at,last_success_at,last_failure_at,last_error_code,last_league_count,last_duration_ms,last_sync_source,sync_lease_expires_at'
          )
          .eq('clerk_user_id', request.userId),
        // Never access_token / refresh_token.
        supabase
          .from('oauth_tokens')
          .select('expires_at,client_name', { count: 'exact' })
          .eq('user_id', request.userId)
          .is('revoked_at', null)
          .gt('expires_at', checkedAt),
        // Stored-state read only; this must never renew a credential.
        credentialHealth(env, request.userId, checkedAtDate),
      ]);

    unwrapRead(yahooPresent, 'yahoo_credentials');
    unwrapRead(espnPresent, 'espn_credentials');
    unwrapRead(sleeperPresent, 'sleeper_connections');
    unwrapRead(leagues, 'yahoo_leagues');
    unwrapRead(sync, 'provider_sync_state');
    unwrapRead(sessions, 'oauth_tokens');

    const leagueRows = (leagues.data ?? []) as Array<{ season_year?: unknown; updated_at?: unknown }>;
    const leagueTimestamps = timestampRange(leagueRows.map((row) => stringOrNull(row.updated_at)));
    const seasons = new Set(
      leagueRows.map((row) => row.season_year).filter((season) => season !== null && season !== undefined)
    );

    const syncRows = (sync.data ?? []) as Array<Record<string, unknown>>;
    const sessionRows = (sessions.data ?? []) as Array<{ expires_at?: unknown; client_name?: unknown }>;
    const sessionExpiries = timestampRange(sessionRows.map((row) => stringOrNull(row.expires_at)));
    const clientNames = [
      ...new Set(sessionRows.map((row) => row.client_name).filter((name): name is string => typeof name === 'string')),
    ].sort();

    report = {
      outcome: 'ok',
      userMasked,
      checkedAt,
      providers: {
        yahoo: (yahooPresent.data ?? []).length > 0,
        espn: (espnPresent.data ?? []).length > 0,
        sleeper: (sleeperPresent.data ?? []).length > 0,
      },
      yahooCredential: credential ?? { connected: false, hasCredentials: false },
      yahooLeagues: {
        rowCount: leagues.count ?? leagueRows.length,
        distinctSeasons: seasons.size,
        oldestUpdatedAt: leagueTimestamps.oldest,
        newestUpdatedAt: leagueTimestamps.newest,
      },
      sync: syncRows
        .map((row) => ({
          provider: typeof row.provider === 'string' ? row.provider : 'unknown',
          lastAttemptAt: stringOrNull(row.last_attempt_at),
          lastSuccessAt: stringOrNull(row.last_success_at),
          lastFailureAt: stringOrNull(row.last_failure_at),
          lastErrorCode: stringOrNull(row.last_error_code),
          lastLeagueCount: numberOrNull(row.last_league_count),
          lastDurationMs: numberOrNull(row.last_duration_ms),
          lastSyncSource: stringOrNull(row.last_sync_source),
          syncLeaseExpiresAt: stringOrNull(row.sync_lease_expires_at),
        }))
        .sort((a, b) => a.provider.localeCompare(b.provider)),
      flaimSessions: {
        activeCount: sessions.count ?? sessionRows.length,
        mostRecentExpiresAt: sessionExpiries.newest,
        clientNames,
      },
    };
  } catch (error) {
    // Message only — it is built by unwrapRead from a label and a driver code.
    console.error(
      '[yahoo-support] Inspect snapshot failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    report = { outcome: 'failed', userMasked, error: 'snapshot_failed' };
  }

  console.log(
    JSON.stringify({
      event: 'yahoo_support_inspect',
      service: 'auth-worker',
      user_id: userMasked,
      outcome: report.outcome,
      correlation_id: correlationId,
    })
  );

  return report;
}
