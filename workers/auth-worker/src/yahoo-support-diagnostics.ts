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
 * those.
 *
 * `runYahooSupportDiagnose` is the one action that reaches Yahoo. It renews the
 * credential through the existing guarded token path and makes at most
 * MAX_YAHOO_DIAGNOSTIC_REQUESTS bounded GETs, and it still writes nothing: no
 * league rows, no sync state. Refresh — the only action that persists — lands
 * in a later change.
 *
 * Redaction is enforced at the query, not the response: every read names its
 * columns explicitly, so a customer league key, league name, team name, or a
 * token can never enter this module's memory in the first place.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  diagnoseYahooDiscovery,
  readYahooCredentialHealthReport,
  MAX_YAHOO_DIAGNOSTIC_REQUESTS,
  type YahooConnectEnv,
  type YahooCredentialHealthReport,
  type YahooSupportDiagnosis,
} from './yahoo-connect-handlers';

// Re-exported so existing callers/tests importing the budget constant from
// this module (the public support-diagnostics surface) don't need to know
// it's actually enforced in yahoo-connect-handlers.ts.
export { MAX_YAHOO_DIAGNOSTIC_REQUESTS };

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

// =============================================================================
// DIAGNOSE — bounded Yahoo probe plus an operator-readable interpretation
// =============================================================================

/**
 * What the diagnosis means, in the operator's language.
 *
 * `summary` and `nextAction` are written to be pasted straight into a Linear
 * comment: one plain sentence each, no customer identifiers, no raw provider
 * payload. The only provider strings that may appear are Yahoo-global game
 * codes, which are not customer data.
 */
export interface DiagnoseInterpretation {
  category:
    | 'not_connected'
    | 'credential_renewal_rejected'
    | 'data_reachable'
    | 'filter_excludes_account'
    | 'genuinely_empty_account'
    | 'parser_dropped_all'
    | 'declared_count_zero_with_entries'
    | 'malformed_payload'
    | 'throttled'
    | 'unexplained_empty_result';
  summary: string;
  nextAction: string;
}

export type YahooSupportDiagnoseReport =
  | {
      outcome: 'ok';
      userMasked: string;
      checkedAt: string;
      correlationId: string;
      diagnosis: YahooSupportDiagnosis;
      interpretation: DiagnoseInterpretation;
    }
  | { outcome: 'failed'; userMasked: string; error: 'diagnostic_failed' };

export type YahooSupportDiagnoseDependencies = {
  now?: () => number;
  diagnose?: typeof diagnoseYahooDiscovery;
};

/** Yahoo answers a throttled caller with 429, or with its own legacy 999. */
const YAHOO_THROTTLE_STATUSES = new Set([429, 999]);

/**
 * Turn a diagnosis into a category, in a fixed priority order.
 *
 * The order is the whole point: several stats signals can co-occur on one
 * payload, and reading them in a different order would tell the operator a
 * different story about the same account. Renewal failure outranks anything
 * observed downstream, throttling outranks payload shape (a throttled response
 * is malformed for an uninteresting reason), and among the parser signals the
 * more specific explanation wins over the more general one.
 */
function interpretDiagnosis(diagnosis: YahooSupportDiagnosis): DiagnoseInterpretation {
  if (diagnosis.stage === 'not_connected') {
    return {
      category: 'not_connected',
      summary: 'This account has no stored Yahoo credential row, so there is nothing for Flaim to sync from.',
      nextAction: 'Ask the customer to connect Yahoo from the Flaim web app, then re-run inspect.',
    };
  }

  if (diagnosis.stage === 'credential_refresh_failed') {
    if (diagnosis.appFingerprintMismatch) {
      return {
        category: 'credential_renewal_rejected',
        summary:
          'The stored Yahoo tokens were minted by a different Yahoo app than this worker is configured with, so no renewal of them can ever succeed.',
        nextAction:
          'Ask the customer to reconnect Yahoo, and check whether other accounts carry the same stale fingerprint before closing.',
      };
    }

    if (diagnosis.retryable) {
      const wait =
        typeof diagnosis.retryAfterSeconds === 'number'
          ? `${diagnosis.retryAfterSeconds} seconds`
          : 'a short while';
      return {
        category: 'credential_renewal_rejected',
        summary: `Yahoo credential renewal was temporarily unavailable (${diagnosis.errorCode}); a refresh lease or cooldown is currently held for this account.`,
        nextAction: `Wait ${wait}, then re-run diagnose once. Do not loop.`,
      };
    }

    const upstream =
      typeof diagnosis.upstreamStatus === 'number' ? `, upstream HTTP ${diagnosis.upstreamStatus}` : '';
    return {
      category: 'credential_renewal_rejected',
      summary: `Yahoo rejected the stored credential (${diagnosis.errorCode}${upstream}), so the grant is dead and cannot be recovered server-side.`,
      nextAction: 'Ask the customer to disconnect and reconnect Yahoo; no refresh will help until they do.',
    };
  }

  const primary = diagnosis.calls[0];
  if (!primary) {
    return {
      category: 'unexplained_empty_result',
      summary: 'The diagnostic completed without recording a discovery call, which should not happen.',
      nextAction: 'Escalate: this is a defect in the diagnostic itself, not in the account.',
    };
  }

  if (primary.httpStatus !== null && YAHOO_THROTTLE_STATUSES.has(primary.httpStatus)) {
    return {
      category: 'throttled',
      summary: `Yahoo throttled the discovery request (HTTP ${primary.httpStatus}), so nothing can be concluded about this account yet.`,
      nextAction: 'Back off, then re-run diagnose once. Never loop.',
    };
  }

  const stats = primary.stats;
  // `!stats` cannot occur alongside a 200-with-envelope from the probe itself;
  // it is here so a malformed diagnosis can never be read as a parse result.
  if (!primary.ok || !primary.bodyIsJson || !primary.bodyLooksLikeEnvelope || !stats || stats.threw) {
    const status = primary.httpStatus === null ? 'no response' : `HTTP ${primary.httpStatus}`;
    const detail = stats?.threw
      ? `the parser threw ${stats.thrownErrorName ?? 'an error'}`
      : `body category ${primary.errorSnippetCategory}`;
    return {
      category: 'malformed_payload',
      summary: `Yahoo's discovery response was not a usable fantasy_content envelope (${status}, ${detail}).`,
      nextAction:
        'File a bug with the status and body category only — never the body itself — and compare it against the earlier Yahoo discovery-500 history.',
    };
  }

  if (stats.accepted > 0) {
    return {
      category: 'data_reachable',
      summary: `Yahoo returned ${stats.accepted} parseable league(s) for this account, so discovery works end to end and only the saved rows are missing.`,
      nextAction: 'Run refresh --confirm for this account, then verify the saved league row count increased.',
    };
  }

  if (stats.declared.games === 0) {
    const fallback = diagnosis.calls[1];
    if (fallback && fallback.ok && fallback.stats && fallback.stats.accepted > 0) {
      return {
        category: 'filter_excludes_account',
        summary: `Yahoo reports no full-type games for this account, yet the unfiltered current-season football query returns ${fallback.stats.accepted} league(s) — the game_types=full discovery filter is excluding this account's real data.`,
        nextAction:
          'File a new bug against the discovery filter and attach this diagnosis. Do not run refresh: it takes the same filtered path and would save nothing.',
      };
    }

    return {
      category: 'genuinely_empty_account',
      summary:
        'Yahoo returns no games and no leagues for this account under both the filtered discovery query and the narrower current-season fallback.',
      nextAction:
        'Confirm with the customer which Yahoo identity holds their leagues; on this evidence it is not a Flaim-side defect.',
    };
  }

  if (stats.declared.leagues > 0 && stats.skipped.unsupportedSportCode > 0) {
    const codes = stats.unsupportedGameCodes.length > 0
      ? stats.unsupportedGameCodes.join(', ')
      : 'none recorded';
    return {
      category: 'parser_dropped_all',
      summary: `Yahoo reported ${stats.declared.leagues} league(s), but every game used a sport code Flaim does not map (${codes}), so the parser dropped all of them.`,
      nextAction: 'File a parser bug to map the listed Yahoo game codes, then re-run diagnose to confirm.',
    };
  }

  if (stats.declared.leagues === 0 && stats.indexed.leagues > 0) {
    return {
      category: 'declared_count_zero_with_entries',
      summary: `Yahoo declared a league count of zero while the payload actually carried ${stats.indexed.leagues} league entr${stats.indexed.leagues === 1 ? 'y' : 'ies'}, so the count-driven walk swallowed a populated level.`,
      nextAction:
        "File a parser bug: the leagues walk must count the entries present rather than trust Yahoo's count field.",
    };
  }

  return {
    category: 'unexplained_empty_result',
    summary:
      'Yahoo returned a well-formed envelope with games but no parseable leagues, and none of the known drop signals fired.',
    nextAction: 'Escalate with this diagnosis attached; the stats block rules out every known failure shape.',
  };
}

/**
 * Diagnose one account's Yahoo discovery and interpret the result.
 *
 * Reaches Yahoo (through `diagnoseYahooDiscovery`, which owns the guarded
 * renewal and the hard request budget) but persists nothing. Any thrown error
 * collapses to a bare `diagnostic_failed`: the operator gets a stable shape,
 * and a driver or provider message never rides out on an error path.
 */
export async function runYahooSupportDiagnose(
  env: YahooSupportEnv,
  request: YahooSupportRequest,
  dependencies: YahooSupportDiagnoseDependencies = {}
): Promise<YahooSupportDiagnoseReport> {
  const now = dependencies.now ?? Date.now;
  const diagnose = dependencies.diagnose ?? diagnoseYahooDiscovery;
  const userMasked = maskUserId(request.userId);
  const correlationId = crypto.randomUUID();
  const checkedAt = new Date(now()).toISOString();

  let report: YahooSupportDiagnoseReport;
  let stage: YahooSupportDiagnosis['stage'] | null = null;
  let yahooRequestCount = 0;

  try {
    // The support env carries the Yahoo client fields as optional; the worker
    // env always supplies them, and the token path independently refuses to
    // call Yahoo when they are missing.
    const diagnosis = await diagnose(env as YahooConnectEnv, request.userId, correlationId);
    stage = diagnosis.stage;
    yahooRequestCount = diagnosis.stage === 'completed' ? diagnosis.requestCount : 0;
    report = {
      outcome: 'ok',
      userMasked,
      checkedAt,
      correlationId,
      diagnosis,
      interpretation: interpretDiagnosis(diagnosis),
    };
  } catch (error) {
    // Name only. Unlike inspect's own labelled read errors, anything thrown
    // here can come from the provider path, where a message may quote a body.
    console.error(
      '[yahoo-support] Diagnose failed:',
      error instanceof Error ? error.name : 'unknown error'
    );
    report = { outcome: 'failed', userMasked, error: 'diagnostic_failed' };
  }

  console.log(
    JSON.stringify({
      event: 'yahoo_support_diagnose',
      service: 'auth-worker',
      user_id: userMasked,
      outcome: report.outcome,
      stage,
      yahoo_request_count: yahooRequestCount,
      correlation_id: correlationId,
    })
  );

  return report;
}
