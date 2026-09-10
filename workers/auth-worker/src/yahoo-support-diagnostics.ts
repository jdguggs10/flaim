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
 * `runYahooSupportDiagnose` reaches Yahoo but still writes nothing. It renews
 * the credential through the existing guarded token path and makes at most
 * MAX_YAHOO_DIAGNOSTIC_REQUESTS bounded GETs: no league rows, no sync state.
 *
 * `runYahooSupportProbeLeague` also reaches Yahoo and also writes nothing, but
 * asks a different question: it makes exactly one live per-league fetch, with
 * an operator-supplied league identifier substituted verbatim, to reproduce a
 * get_league_info-style failure on demand.
 *
 * `runYahooSupportRefresh` is the only action that persists, and it owns none
 * of that persistence: it calls `refreshLeaguesForUser` with a scheduled sync's
 * own arguments and reports the saved state either side of it.
 *
 * Redaction is enforced at the query, not the response: every read names its
 * columns explicitly, so a customer league key, league name, team name, or a
 * token can never enter this module's memory in the first place. The one
 * documented exception is `probe-league`'s bounded `errorDescription` — see
 * `ProbeLeagueInterpretation`, which explains why that specific string is safe
 * to project and why it does not generalize.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  refreshLeaguesForUser,
  sanitizeProviderResult,
  type SanitizedProviderResult,
} from './league-refresh';
import {
  diagnoseYahooDiscovery,
  probeYahooLeague,
  readYahooCredentialHealthReport,
  MAX_YAHOO_DIAGNOSTIC_REQUESTS,
  YAHOO_SUPPORT_LEAGUE_ID_PATTERN,
  type YahooConnectEnv,
  type YahooCredentialHealthReport,
  type YahooCredentialRefreshFailure,
  type YahooDiagnosticCall,
  type YahooSupportDiagnosis,
  type YahooSupportLeagueProbe,
} from './yahoo-connect-handlers';

// Re-exported so existing callers/tests importing the budget constant from
// this module (the public support-diagnostics surface) don't need to know
// it's actually enforced in yahoo-connect-handlers.ts.
export { MAX_YAHOO_DIAGNOSTIC_REQUESTS };

export const CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9]{20,64}$/;

// Re-exported for the same reason as the budget constant above: the league-id
// charset is enforced in yahoo-connect-handlers.ts (where the URL is built),
// and callers should be able to read it off the public support surface.
export { YAHOO_SUPPORT_LEAGUE_ID_PATTERN };

// Duplicated locally rather than imported from any of the ~13 other modules
// that already carry their own private copy — that duplication is this
// codebase's existing convention for a one-line helper, not something worth
// a new shared package to avoid.
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

/** `probe-league` is the only action that takes a second field. */
export interface YahooSupportLeagueRequest {
  userId: string;
  leagueId: string;
}

type ValidationError = {
  error: { status: 400 | 413; body: { error: string; error_description: string } };
};

export type YahooSupportValidation = { request: YahooSupportRequest } | ValidationError;

export type YahooSupportLeagueValidation =
  | { request: YahooSupportLeagueRequest }
  | ValidationError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRequest(
  error: string,
  errorDescription: string,
  status: 400 | 413 = 400
): ValidationError {
  return { error: { status, body: { error, error_description: errorDescription } } };
}

/**
 * Everything every support request must clear before any field is read: the
 * byte cap (declared, then actual), valid JSON, a JSON object, and a fixed
 * allowed-key set. Shared so a second route can never be added with a looser
 * prelude than the first one has.
 */
async function readSupportRequestBody(
  request: Request,
  allowedKeys: ReadonlySet<string>
): Promise<{ body: Record<string, unknown> } | ValidationError> {
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

  const unknownKey = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unknownKey) return invalidRequest('invalid_request', `Unknown request field: ${unknownKey}`);

  return { body };
}

const INSPECT_ALLOWED_KEYS: ReadonlySet<string> = new Set(['userId']);
const LEAGUE_PROBE_ALLOWED_KEYS: ReadonlySet<string> = new Set(['userId', 'leagueId']);

export async function parseYahooSupportRequest(request: Request): Promise<YahooSupportValidation> {
  const parsed = await readSupportRequestBody(request, INSPECT_ALLOWED_KEYS);
  if ('error' in parsed) return parsed;

  const { body } = parsed;
  if (typeof body.userId !== 'string' || !CLERK_USER_ID_PATTERN.test(body.userId)) {
    return invalidRequest('invalid_user_id', 'userId must be a valid user ID');
  }

  return { request: { userId: body.userId } };
}

/**
 * The `probe-league` request: the same strict discipline as above, plus one
 * extra field.
 *
 * `leagueId` is whatever string the customer reported, and it is substituted
 * into a Yahoo URL verbatim, so its charset is checked here rather than
 * normalised — see `probeYahooLeague`, which checks the same pattern again
 * before building the URL.
 */
export async function parseYahooSupportLeagueRequest(
  request: Request
): Promise<YahooSupportLeagueValidation> {
  const parsed = await readSupportRequestBody(request, LEAGUE_PROBE_ALLOWED_KEYS);
  if ('error' in parsed) return parsed;

  const { body } = parsed;
  if (typeof body.userId !== 'string' || !CLERK_USER_ID_PATTERN.test(body.userId)) {
    return invalidRequest('invalid_user_id', 'userId must be a valid user ID');
  }

  if (typeof body.leagueId !== 'string' || !YAHOO_SUPPORT_LEAGUE_ID_PATTERN.test(body.leagueId)) {
    return invalidRequest(
      'invalid_league_id',
      'leagueId must be 1-64 characters of letters, digits, dot, underscore, or hyphen'
    );
  }

  return { request: { userId: body.userId, leagueId: body.leagueId } };
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

/**
 * The only column list any support read of `provider_sync_state` may use.
 * Shared by inspect (all providers) and refresh (the yahoo row, before and
 * after), so a column can never be added to one reader's list alone.
 */
const PROVIDER_SYNC_STATE_COLUMNS =
  'provider,last_attempt_at,last_success_at,last_failure_at,last_error_code,last_league_count,last_duration_ms,last_sync_source,sync_lease_expires_at';

function toSyncSnapshot(row: Record<string, unknown>): YahooSupportSyncSnapshot {
  return {
    provider: typeof row.provider === 'string' ? row.provider : 'unknown',
    lastAttemptAt: stringOrNull(row.last_attempt_at),
    lastSuccessAt: stringOrNull(row.last_success_at),
    lastFailureAt: stringOrNull(row.last_failure_at),
    lastErrorCode: stringOrNull(row.last_error_code),
    lastLeagueCount: numberOrNull(row.last_league_count),
    lastDurationMs: numberOrNull(row.last_duration_ms),
    lastSyncSource: stringOrNull(row.last_sync_source),
    syncLeaseExpiresAt: stringOrNull(row.sync_lease_expires_at),
  };
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
          .select(PROVIDER_SYNC_STATE_COLUMNS)
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
      sync: syncRows.map(toSyncSnapshot).sort((a, b) => a.provider.localeCompare(b.provider)),
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
    | 'fallback_inconclusive'
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
/**
 * The two pre-provider outcomes every support action that reaches Yahoo shares:
 * there is no credential, or renewing it was refused. Both `diagnose` and
 * `probe-league` stop at exactly these points for exactly these reasons, so the
 * sentences an operator reads are written once here rather than twice.
 */
type SharedCredentialCategory = 'not_connected' | 'credential_renewal_rejected';

interface SharedCredentialInterpretation {
  category: SharedCredentialCategory;
  summary: string;
  nextAction: string;
}

/**
 * `command` names the command to re-run in the retryable branch, so the advice
 * points at whatever the operator actually ran rather than always at diagnose.
 */
function interpretNotConnected(): SharedCredentialInterpretation {
  return {
    category: 'not_connected',
    summary: 'This account has no stored Yahoo credential row, so there is nothing for Flaim to sync from.',
    nextAction: 'Ask the customer to connect Yahoo from the Flaim web app, then re-run inspect.',
  };
}

function interpretCredentialRefreshFailure(
  failure: YahooCredentialRefreshFailure,
  command: 'diagnose' | 'probe-league'
): SharedCredentialInterpretation {
  if (failure.appFingerprintMismatch) {
    return {
      category: 'credential_renewal_rejected',
      summary:
        'The stored Yahoo tokens were minted by a different Yahoo app than this worker is configured with, so no renewal of them can ever succeed.',
      nextAction:
        'Ask the customer to reconnect Yahoo, and check whether other accounts carry the same stale fingerprint before closing.',
    };
  }

  if (failure.retryable) {
    const wait =
      typeof failure.retryAfterSeconds === 'number'
        ? `${failure.retryAfterSeconds} seconds`
        : 'a short while';
    return {
      category: 'credential_renewal_rejected',
      summary: `Yahoo credential renewal was temporarily unavailable (${failure.errorCode}); a refresh lease or cooldown is currently held for this account.`,
      nextAction: `Wait ${wait}, then re-run ${command} once. Do not loop.`,
    };
  }

  const upstream =
    typeof failure.upstreamStatus === 'number' ? `, upstream HTTP ${failure.upstreamStatus}` : '';
  return {
    category: 'credential_renewal_rejected',
    summary: `Yahoo rejected the stored credential (${failure.errorCode}${upstream}), so the grant is dead and cannot be recovered server-side.`,
    nextAction: 'Ask the customer to disconnect and reconnect Yahoo; no refresh will help until they do.',
  };
}

function interpretDiagnosis(diagnosis: YahooSupportDiagnosis): DiagnoseInterpretation {
  if (diagnosis.stage === 'not_connected') return interpretNotConnected();
  if (diagnosis.stage === 'credential_refresh_failed') {
    return interpretCredentialRefreshFailure(diagnosis, 'diagnose');
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

    // The fallback exists to answer one question: does this account genuinely
    // have no data? It can only answer that if it itself came back as a valid,
    // parseable envelope. A fallback that errored, timed out, or came back
    // malformed answered nothing — reporting "genuinely empty" on that basis
    // would tell an operator (and possibly a customer) the account has no data
    // when the truth is the second probe simply failed to find out.
    const fallbackAnswered =
      fallback !== undefined
      && fallback.ok
      && fallback.bodyIsJson
      && fallback.bodyLooksLikeEnvelope
      && fallback.stats !== null
      && !fallback.stats.threw;

    if (!fallbackAnswered) {
      const status = fallback === undefined
        ? 'no fallback call was recorded'
        : fallback.httpStatus === null
          ? 'no response'
          : `HTTP ${fallback.httpStatus}, body category ${fallback.errorSnippetCategory}`;
      return {
        category: 'fallback_inconclusive',
        summary: `Yahoo reports no full-type games for this account, but the confirming current-season fallback probe did not itself succeed (${status}), so whether this account genuinely has no data is unresolved.`,
        nextAction:
          'Re-run diagnose once. If it keeps failing, investigate the fallback request itself before telling the customer anything — do not report this account as empty on inconclusive evidence.',
      };
    }

    if (fallback.stats!.accepted > 0) {
      return {
        category: 'filter_excludes_account',
        summary: `Yahoo reports no full-type games for this account, yet the unfiltered current-season football query returns ${fallback.stats!.accepted} league(s) — the game_types=full discovery filter is excluding this account's real data.`,
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
 * renewal and the hard discovery-call budget) but never persists league data
 * or sync state: no `upsertYahooLeague`, no `settle()`/`acquireLease()`, no
 * call into `refreshLeaguesForUser`/`handleYahooDiscover`. It does still
 * exercise the ordinary credential-renewal write when the token needs it —
 * that mutation is inherent to reusing the real renewal path unmodified, not
 * an exception to "never persists," which here means never persists *league
 * or sync-state* data. Any thrown error collapses to a bare
 * `diagnostic_failed`: the operator gets a stable shape, and a driver or
 * provider message never rides out on an error path.
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

// =============================================================================
// PROBE-LEAGUE — one live per-league fetch, reproduced on demand
// =============================================================================

/**
 * What one live per-league fetch means, in the operator's language.
 *
 * The first two categories are shared verbatim with `diagnose` (see
 * `interpretNotConnected` / `interpretCredentialRefreshFailure`); the rest are
 * this probe's own. `RUNBOOK.md`'s probe-league section has one branch each.
 */
export interface ProbeLeagueInterpretation {
  category:
    | SharedCredentialCategory
    | 'succeeded'
    | 'yahoo_rejected'
    | 'throttled'
    | 'malformed_payload';
  summary: string;
  nextAction: string;
  /**
   * Yahoo's own explanation, capped, and only on `yahoo_rejected`.
   *
   * The deliberate exception to "this module surfaces categories, never free
   * text", and the same exception `refresh` already documents around
   * `provider.error_description` (`RUNBOOK.md` §5): for a malformed league key
   * the category alone says "Yahoo said no" while this string says *why*, which
   * is the whole reason an operator runs this command. It is safe to project
   * here in a way it would not be elsewhere in this module: this action never
   * queries `yahoo_leagues`, so the identifier inside it is the one the
   * operator typed, not one read out of the customer's stored rows. It is still
   * free provider text — read it before pasting it anywhere.
   */
  errorDescription?: string;
}

/**
 * The observation, reduced to what an operator acts on.
 *
 * Deliberately not the whole `YahooDiagnosticCall`: `url` carries the
 * substituted league id back out, and `stats`/`parsedLeagueCount` come from the
 * *discovery* parser, which has no meaning against a `/league/{id}/teams`
 * payload and would read as a finding rather than as noise.
 */
export interface ProbeLeagueCall {
  label: YahooDiagnosticCall['label'];
  httpStatus: number | null;
  ok: boolean;
  bodyIsJson: boolean;
  bodyLooksLikeEnvelope: boolean;
  errorSnippetCategory: YahooDiagnosticCall['errorSnippetCategory'];
  durationMs: number;
}

export type YahooSupportProbeLeagueReport =
  | {
      outcome: 'ok';
      userMasked: string;
      checkedAt: string;
      correlationId: string;
      /** Null when the probe stopped before reaching Yahoo at all. */
      call: ProbeLeagueCall | null;
      interpretation: ProbeLeagueInterpretation;
    }
  | { outcome: 'failed'; userMasked: string; error: 'probe_failed' };

export type YahooSupportProbeLeagueDependencies = {
  now?: () => number;
  probe?: typeof probeYahooLeague;
};

function toProbeLeagueCall(call: YahooDiagnosticCall): ProbeLeagueCall {
  return {
    label: call.label,
    httpStatus: call.httpStatus,
    ok: call.ok,
    bodyIsJson: call.bodyIsJson,
    bodyLooksLikeEnvelope: call.bodyLooksLikeEnvelope,
    errorSnippetCategory: call.errorSnippetCategory,
    durationMs: call.durationMs,
  };
}

/**
 * Turn one probe result into a category, in a fixed priority order.
 *
 * Same ordering principle as `interpretDiagnosis`: renewal failure outranks
 * anything observed downstream, and throttling outranks payload shape, because
 * a throttled response is malformed for an uninteresting reason.
 */
function interpretLeagueProbe(probe: YahooSupportLeagueProbe): ProbeLeagueInterpretation {
  if (probe.stage === 'not_connected') return interpretNotConnected();
  if (probe.stage === 'credential_refresh_failed') {
    return interpretCredentialRefreshFailure(probe, 'probe-league');
  }

  const call = probe.call;

  if (call.httpStatus !== null && YAHOO_THROTTLE_STATUSES.has(call.httpStatus)) {
    return {
      category: 'throttled',
      summary: `Yahoo throttled the league request (HTTP ${call.httpStatus}), so nothing can be concluded about this league yet.`,
      nextAction: 'Back off, then re-run probe-league once. Never loop.',
    };
  }

  if (call.httpStatus === 200 && call.ok && call.bodyIsJson && call.bodyLooksLikeEnvelope) {
    return {
      category: 'succeeded',
      summary:
        'Yahoo answered this exact league request with a normal fantasy_content envelope, so the live per-league path works for this account right now.',
      nextAction:
        'Ask the customer to retry and confirm. If they still see the error, capture the exact time and league they used — what they hit is not reproducing here.',
    };
  }

  if (call.bodyIsJson && call.errorSnippetCategory === 'yahoo_error_json') {
    return {
      category: 'yahoo_rejected',
      summary: `Yahoo refused this exact league request (HTTP ${call.httpStatus === null ? 'no response' : call.httpStatus}) with an error body of its own, which is the shape a malformed league key produces.`,
      nextAction:
        'File a bug with the category and the error description below. Do not tell the customer to reconnect — the credential worked; the identifier sent to Yahoo did not.',
      ...(probe.errorDescription !== undefined ? { errorDescription: probe.errorDescription } : {}),
    };
  }

  const status = call.httpStatus === null ? 'no response' : `HTTP ${call.httpStatus}`;
  return {
    category: 'malformed_payload',
    summary: `Yahoo's answer to this league request was neither a usable envelope nor a recognizable Yahoo error (${status}, body category ${call.errorSnippetCategory}).`,
    nextAction:
      'Re-run probe-league once. If it reproduces, file a bug with the status and body category only — never the body itself.',
  };
}

/**
 * Reproduce one live per-league Yahoo fetch for an account and interpret it.
 *
 * The sibling of `runYahooSupportDiagnose` for the case its decision tree does
 * not cover: the customer's leagues *are* stored and visible, and a specific
 * live fetch for one of them fails. Reaches Yahoo through `probeYahooLeague`
 * (which owns the guarded renewal and the single-call bound) and persists no
 * league or sync-state data. Any thrown error collapses to a bare
 * `probe_failed`, matching diagnose: a provider or driver message never rides
 * out on an error path.
 */
export async function runYahooSupportProbeLeague(
  env: YahooSupportEnv,
  request: YahooSupportLeagueRequest,
  dependencies: YahooSupportProbeLeagueDependencies = {}
): Promise<YahooSupportProbeLeagueReport> {
  const now = dependencies.now ?? Date.now;
  const probe = dependencies.probe ?? probeYahooLeague;
  const userMasked = maskUserId(request.userId);
  const correlationId = crypto.randomUUID();
  const checkedAt = new Date(now()).toISOString();

  let report: YahooSupportProbeLeagueReport;
  let stage: YahooSupportLeagueProbe['stage'] | null = null;
  let category: ProbeLeagueInterpretation['category'] | null = null;

  try {
    const result = await probe(
      env as YahooConnectEnv,
      request.userId,
      request.leagueId,
      correlationId
    );
    stage = result.stage;
    const interpretation = interpretLeagueProbe(result);
    category = interpretation.category;
    report = {
      outcome: 'ok',
      userMasked,
      checkedAt,
      correlationId,
      call: result.stage === 'completed' ? toProbeLeagueCall(result.call) : null,
      interpretation,
    };
  } catch (error) {
    // Name only — anything thrown here can come from the provider path, where a
    // message may quote a body.
    console.error(
      '[yahoo-support] League probe failed:',
      error instanceof Error ? error.name : 'unknown error'
    );
    report = { outcome: 'failed', userMasked, error: 'probe_failed' };
  }

  // The league id is deliberately absent from this line. It is operator input,
  // not a stored customer value, and the audit log has no need of it.
  console.log(
    JSON.stringify({
      event: 'yahoo_support_probe_league',
      service: 'auth-worker',
      user_id: userMasked,
      outcome: report.outcome,
      stage,
      category,
      correlation_id: correlationId,
    })
  );

  return report;
}

// =============================================================================
// REFRESH — the normal guarded refresh, with proof of what changed
// =============================================================================

/**
 * The saved state refresh is meant to move: how many Yahoo league rows exist,
 * and what the yahoo sync row says. `sync` is null only when no
 * `provider_sync_state` row exists for this account yet — an account that has
 * never attempted a Yahoo sync.
 */
export interface YahooSupportRefreshSnapshot {
  leagueRows: number;
  sync: YahooSupportSyncSnapshot | null;
}

export type YahooSupportRefreshReport =
  | {
      outcome: 'ok';
      userMasked: string;
      correlationId: string;
      before: YahooSupportRefreshSnapshot;
      provider: SanitizedProviderResult;
      after: YahooSupportRefreshSnapshot;
    }
  | { outcome: 'failed'; userMasked: string; error: 'refresh_result_missing' | 'snapshot_failed' | 'refresh_failed' };

export type YahooSupportRefreshDependencies = {
  now?: () => number;
  refresh?: typeof refreshLeaguesForUser;
  supabase?: SupabaseClient;
};

/**
 * Both halves of the before/after pair, from the same column lists inspect uses.
 * Never `league_key` / `league_name` / `team_name` / `team_key`: a count is the
 * only thing this action needs from `yahoo_leagues`.
 *
 * Returns null on a read failure rather than throwing, so the caller can keep
 * the guarded refresh call outside any catch of its own — a failure inside that
 * call must not be reported as a failed snapshot.
 */
async function readRefreshSnapshot(
  supabase: SupabaseClient,
  userId: string
): Promise<YahooSupportRefreshSnapshot | null> {
  try {
    return await readRefreshSnapshotOrThrow(supabase, userId);
  } catch (error) {
    // Message only — it is built by unwrapRead from a label and a driver code.
    console.error(
      '[yahoo-support] Refresh snapshot failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return null;
  }
}

async function readRefreshSnapshotOrThrow(
  supabase: SupabaseClient,
  userId: string
): Promise<YahooSupportRefreshSnapshot> {
  const [leagues, sync] = await Promise.all([
    supabase.from('yahoo_leagues').select('season_year', { count: 'exact' }).eq('clerk_user_id', userId),
    supabase
      .from('provider_sync_state')
      .select(PROVIDER_SYNC_STATE_COLUMNS)
      .eq('clerk_user_id', userId)
      .eq('provider', 'yahoo'),
  ]);

  unwrapRead(leagues, 'yahoo_leagues');
  unwrapRead(sync, 'provider_sync_state');

  const leagueRows = (leagues.data ?? []) as unknown[];
  const syncRows = (sync.data ?? []) as Array<Record<string, unknown>>;
  return {
    leagueRows: leagues.count ?? leagueRows.length,
    sync: syncRows.length > 0 ? toSyncSnapshot(syncRows[0]) : null,
  };
}

/**
 * Run the normal Yahoo league refresh for one account and prove what it changed.
 *
 * Unlike diagnose, this classifies nothing: by the time an operator runs it they
 * already know why (diagnose said the data is reachable). Its entire job is to
 * run the ordinary path and show the before/after difference.
 *
 * The refresh call is `refreshLeaguesForUser` with exactly the arguments a
 * scheduled sync uses, so every existing guard applies unmodified — lease,
 * cooldown, provider call, `settle()`, persistence. There is no support-specific
 * refresh path and there must never be one: an operator-triggered refresh that
 * behaved differently from the customer's own would prove nothing about the
 * customer's own.
 *
 * The "after" snapshot is read strictly after that call resolves. Reading it
 * concurrently would race the persistence the refresh is doing and could show
 * the operator a half-written state as the outcome.
 */
export async function runYahooSupportRefresh(
  env: YahooSupportEnv,
  request: YahooSupportRequest,
  dependencies: YahooSupportRefreshDependencies = {}
): Promise<YahooSupportRefreshReport> {
  const now = dependencies.now ?? Date.now;
  const refresh = dependencies.refresh ?? refreshLeaguesForUser;
  const userMasked = maskUserId(request.userId);
  const correlationId = crypto.randomUUID();
  const startedAt = now();

  const supabase =
    dependencies.supabase ??
    createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  let report: YahooSupportRefreshReport;
  let provider: SanitizedProviderResult | null = null;

  try {
    const before = await readRefreshSnapshot(supabase, request.userId);
    if (!before) {
      report = { outcome: 'failed', userMasked, error: 'snapshot_failed' };
    } else {
      const result = await refresh(env, request.userId, ['yahoo'], {}, correlationId, 'scheduled');
      const yahoo = result.results.yahoo;
      if (!yahoo) {
        // No provider result means the refresh never ran the Yahoo leg at all.
        // Deliberately no "after" read: there is nothing whose change it could
        // attribute, and any difference would be someone else's write.
        report = { outcome: 'failed', userMasked, error: 'refresh_result_missing' };
      } else {
        provider = sanitizeProviderResult(yahoo);
        const after = await readRefreshSnapshot(supabase, request.userId);
        report = after
          ? { outcome: 'ok', userMasked, correlationId, before, provider, after }
          : { outcome: 'failed', userMasked, error: 'snapshot_failed' };
      }
    }
  } catch (error) {
    // Name only, matching diagnose's discipline: a thrown message from the
    // guarded refresh path (or a Supabase driver) can quote upstream or
    // database detail. Without this catch, a throw here would both skip the
    // audit log below and reach the caller as a bare unhandled 500 instead of
    // this module's stable failure shape — readRefreshSnapshot already
    // catches its own errors and returns null, so this is specifically
    // catching `refresh` (refreshLeaguesForUser) itself.
    console.error(
      '[yahoo-support] Refresh failed:',
      error instanceof Error ? error.name : 'unknown error'
    );
    report = { outcome: 'failed', userMasked, error: 'refresh_failed' };
  }

  console.log(
    JSON.stringify({
      event: 'yahoo_support_refresh',
      service: 'auth-worker',
      user_id: userMasked,
      outcome: report.outcome,
      status: provider?.status ?? null,
      league_count: provider?.leagueCount ?? null,
      duration_ms: now() - startedAt,
      correlation_id: correlationId,
    })
  );

  return report;
}
