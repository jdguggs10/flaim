/**
 * Scheduled league rollover reconciliation — DRY-RUN ONLY (FLA-161).
 * ---------------------------------------------------------------------------
 *
 * Around sport rollover dates, users whose leagues were synced last season
 * have stale rows until they manually refresh. This module proves a scheduled
 * job can safely detect provider-verified new seasons: it selects a tiny
 * cohort of users with prior-season-only leagues, asks each provider (read
 * only) which current-season leagues exist, and logs what a write pass WOULD
 * have inserted.
 *
 * There is deliberately no write mode: no code path here inserts, updates,
 * deletes, archives, hides, or changes defaults on league state. The only
 * writes on this path are the provider_sync_state lease/telemetry (FLA-121,
 * shared with manual refresh so scheduled and manual syncs can't run
 * concurrently for the same user/provider) and — only when Yahoo is
 * explicitly allowlisted — OAuth token rotation inside the existing guarded
 * Yahoo token path.
 *
 * Every run emits structured `league_reconciliation` JSON log lines
 * (run_start, one per user+provider probe, run_end), a separate event from
 * `provider_sync` so real refresh metrics stay clean.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getDefaultSeasonYear, toCanonicalYear, type SeasonSport } from './season-utils';
import {
  SyncStateStorage,
  UPSTREAM_BACKOFF_COOLDOWN_SECONDS,
  type SyncProvider,
} from './sync-state';
import { EspnSupabaseStorage } from './supabase-storage';
import { discoverLeaguesV3 } from './v3/league-discovery';
import { AutomaticLeagueDiscoveryFailed, EspnAuthenticationFailed, gameIdToSport } from './espn-types';
import { fetchSleeperLeaguesReadOnly, type SleeperConnectEnv } from './sleeper-connect-handlers';
import { fetchYahooLeaguesReadOnly, type YahooConnectEnv } from './yahoo-connect-handlers';

// =============================================================================
// CONFIG
// =============================================================================

export interface ReconciliationEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  RECONCILIATION_ENABLED?: string;
  RECONCILIATION_DRY_RUN?: string;
  RECONCILIATION_MAX_USERS_PER_RUN?: string;
  RECONCILIATION_BATCH_SIZE?: string;
  RECONCILIATION_PROVIDERS?: string;
  RECONCILIATION_SPORTS?: string;
  RECONCILIATION_TIMEOUT_BUDGET_MS?: string;
  YAHOO_CLIENT_ID?: string;
  YAHOO_CLIENT_SECRET?: string;
  ENVIRONMENT?: string;
  NODE_ENV?: string;
  FRONTEND_URL?: string;
}

export interface ReconciliationConfig {
  enabled: boolean;
  dryRun: boolean;
  maxUsersPerRun: number;
  batchSize: number;
  providers: SyncProvider[];
  sports: SeasonSport[];
  timeoutBudgetMs: number;
}

const KNOWN_PROVIDERS: SyncProvider[] = ['espn', 'yahoo', 'sleeper'];
const KNOWN_SPORTS: SeasonSport[] = ['football', 'baseball', 'basketball', 'hockey'];

/**
 * Yahoo is excluded by default: its probe needs an OAuth access token, and
 * refreshing one rotates yahoo_credentials. That write goes through the
 * existing guarded token path, but it should be an explicit operator choice.
 */
const DEFAULT_PROVIDERS: SyncProvider[] = ['espn', 'sleeper'];
const DEFAULT_SPORTS: SeasonSport[] = ['football'];
const DEFAULT_MAX_USERS_PER_RUN = 5;
const DEFAULT_BATCH_SIZE = 2;
const DEFAULT_TIMEOUT_BUDGET_MS = 45_000;

function parseBoundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function parseAllowlist<T extends string>(raw: string | undefined, known: T[], fallback: T[]): T[] {
  if (!raw?.trim()) return fallback;
  const requested = raw.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const allowed = known.filter((entry) => requested.includes(entry));
  return allowed.length > 0 ? allowed : fallback;
}

export function parseReconciliationConfig(env: ReconciliationEnv): ReconciliationConfig {
  return {
    enabled: env.RECONCILIATION_ENABLED === 'true',
    // Default true, and anything other than the literal 'true' makes the run
    // refuse: write mode does not exist, so a config that asks for it is a
    // misconfiguration, not a fallback to dry-run.
    dryRun: (env.RECONCILIATION_DRY_RUN ?? 'true') === 'true',
    maxUsersPerRun: parseBoundedInt(env.RECONCILIATION_MAX_USERS_PER_RUN, DEFAULT_MAX_USERS_PER_RUN, 1, 50),
    batchSize: parseBoundedInt(env.RECONCILIATION_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 10),
    providers: parseAllowlist(env.RECONCILIATION_PROVIDERS, KNOWN_PROVIDERS, DEFAULT_PROVIDERS),
    sports: parseAllowlist(env.RECONCILIATION_SPORTS, KNOWN_SPORTS, DEFAULT_SPORTS),
    timeoutBudgetMs: parseBoundedInt(env.RECONCILIATION_TIMEOUT_BUDGET_MS, DEFAULT_TIMEOUT_BUDGET_MS, 5_000, 300_000),
  };
}

// =============================================================================
// CANDIDATE SELECTION (pure)
// =============================================================================

export interface StoredLeagueSnapshotRow {
  userId: string;
  sport: string;
  seasonYear: number;
  /** Platform league identifier: league_id (ESPN/Sleeper) or league_key (Yahoo). */
  leagueId: string;
  recurringLeagueId: string | null;
}

export interface ProviderCandidate {
  userId: string;
  provider: SyncProvider;
  /** Sports where this user has prior-season rows but no current-season row. */
  sports: SeasonSport[];
  /** Snapshot of the user's stored rows for this provider (selection time). */
  rows: StoredLeagueSnapshotRow[];
}

export interface CandidateSelection {
  candidates: ProviderCandidate[];
  /** Distinct users eligible before the max-users cap. */
  eligibleUsers: number;
  selectedUsers: number;
}

export function selectCandidates(
  rowsByProvider: Partial<Record<SyncProvider, StoredLeagueSnapshotRow[]>>,
  sports: SeasonSport[],
  currentYearBySport: Record<string, number>,
  maxUsers: number
): CandidateSelection {
  const eligible: ProviderCandidate[] = [];

  for (const provider of KNOWN_PROVIDERS) {
    const rows = rowsByProvider[provider];
    if (!rows?.length) continue;

    const byUser = new Map<string, StoredLeagueSnapshotRow[]>();
    for (const row of rows) {
      const list = byUser.get(row.userId);
      if (list) list.push(row);
      else byUser.set(row.userId, [row]);
    }

    for (const [userId, userRows] of byUser) {
      const staleSports = sports.filter((sport) => {
        const currentYear = currentYearBySport[sport];
        if (currentYear === undefined) return false;
        const sportRows = userRows.filter((row) => row.sport === sport);
        const hasCurrent = sportRows.some((row) => row.seasonYear === currentYear);
        const hasPrior = sportRows.some((row) => row.seasonYear < currentYear);
        return hasPrior && !hasCurrent;
      });
      if (staleSports.length > 0) {
        eligible.push({ userId, provider, sports: staleSports, rows: userRows });
      }
    }
  }

  // Deterministic order so repeated runs probe the same tiny cohort until it
  // shrinks, which makes day-over-day dry-run evidence comparable.
  eligible.sort((a, b) => a.userId.localeCompare(b.userId) || a.provider.localeCompare(b.provider));

  const eligibleUsers = new Set(eligible.map((candidate) => candidate.userId)).size;
  const selected: ProviderCandidate[] = [];
  const selectedUsers = new Set<string>();
  for (const candidate of eligible) {
    if (!selectedUsers.has(candidate.userId) && selectedUsers.size >= maxUsers) continue;
    selectedUsers.add(candidate.userId);
    selected.push(candidate);
  }

  return { candidates: selected, eligibleUsers, selectedUsers: selectedUsers.size };
}

// =============================================================================
// READ-ONLY PROVIDER PROBES
// =============================================================================

export interface DiscoveredCurrentLeague {
  sport: SeasonSport;
  /** Canonical (start-year) season. */
  seasonYear: number;
  /** Platform league identifier, same form as StoredLeagueSnapshotRow.leagueId. */
  leagueId: string;
  /**
   * Provider-supplied pointer to the prior season's league (Sleeper
   * previous_league_id, Yahoo renew-derived league_key). Recurring-identity
   * evidence for the defaults-carry-forward decision.
   */
  priorLeagueHint?: string;
}

export type ProbeResult =
  | { status: 'ok'; leagues: DiscoveredCurrentLeague[] }
  | { status: 'not_connected' }
  | { status: 'error'; errorCode: string; httpStatus?: number; retryable?: boolean; retryAfterSeconds?: number };

async function probeEspn(
  env: ReconciliationEnv,
  userId: string,
  sports: SeasonSport[],
  currentYearBySport: Record<string, number>
): Promise<ProbeResult> {
  const storage = EspnSupabaseStorage.fromEnvironment(env);
  const credentials = await storage.getCredentials(userId);
  if (!credentials) return { status: 'not_connected' };

  try {
    const discovered = await discoverLeaguesV3(credentials.swid, credentials.s2);
    const leagues: DiscoveredCurrentLeague[] = [];
    for (const league of discovered) {
      const sport = gameIdToSport(league.gameId) as SeasonSport | null;
      if (!sport || !sports.includes(sport)) continue;
      const seasonYear = toCanonicalYear(league.seasonId, sport, 'espn');
      if (seasonYear !== currentYearBySport[sport]) continue;
      leagues.push({ sport, seasonYear, leagueId: league.leagueId });
    }
    return { status: 'ok', leagues };
  } catch (error) {
    if (error instanceof EspnAuthenticationFailed) {
      return { status: 'error', errorCode: 'espn_auth_failed', httpStatus: 401, retryable: false };
    }
    if (error instanceof AutomaticLeagueDiscoveryFailed && /No fantasy leagues found/i.test(error.message)) {
      // Valid provider answer: the credentials work but ESPN reports no
      // fantasy leagues at all — nothing rolled over.
      return { status: 'ok', leagues: [] };
    }
    // discoverLeaguesV3 folds the Fan API status into the error message; pull
    // it back out so a 429 settles with the upstream backoff, not 1s.
    const statusMatch = error instanceof Error ? /Fan API returned (\d{3})/.exec(error.message) : null;
    const timedOut = error instanceof Error && /timed out|timeout/i.test(error.message);
    return {
      status: 'error',
      errorCode: timedOut ? 'espn_timeout' : 'discovery_failed',
      ...(statusMatch ? { httpStatus: Number(statusMatch[1]) } : {}),
      retryable: true,
    };
  }
}

const SLEEPER_SPORT_CODES: Partial<Record<SeasonSport, string>> = {
  football: 'nfl',
  basketball: 'nba',
};

async function probeSleeper(
  env: ReconciliationEnv,
  userId: string,
  sports: SeasonSport[],
  currentYearBySport: Record<string, number>
): Promise<ProbeResult> {
  const requests = sports.flatMap((sport) => {
    const sleeperSport = SLEEPER_SPORT_CODES[sport];
    const seasonYear = currentYearBySport[sport];
    return sleeperSport && seasonYear !== undefined ? [{ sleeperSport, seasonYear }] : [];
  });
  if (requests.length === 0) return { status: 'ok', leagues: [] };

  const result = await fetchSleeperLeaguesReadOnly(env as SleeperConnectEnv, userId, requests);
  if (result.status === 'not_connected') return { status: 'not_connected' };
  if (result.status === 'error') {
    return {
      status: 'error',
      errorCode: result.errorCode,
      ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
      retryable: true,
    };
  }

  const leagues: DiscoveredCurrentLeague[] = [];
  for (const league of result.leagues) {
    const sport = league.sport as SeasonSport;
    if (!sports.includes(sport) || league.seasonYear !== currentYearBySport[sport]) continue;
    leagues.push({
      sport,
      seasonYear: league.seasonYear,
      leagueId: league.leagueId,
      ...(league.previousLeagueId ? { priorLeagueHint: league.previousLeagueId } : {}),
    });
  }
  return { status: 'ok', leagues };
}

/** Convert Yahoo's renew pointer (`{game_key}_{league_id}`) to a league_key. */
export function yahooRenewToLeagueKey(renew: string | undefined): string | undefined {
  if (!renew) return undefined;
  const match = /^(\w+)_(\d+)$/.exec(renew);
  return match ? `${match[1]}.l.${match[2]}` : undefined;
}

async function probeYahoo(
  env: ReconciliationEnv,
  userId: string,
  sports: SeasonSport[],
  currentYearBySport: Record<string, number>,
  correlationId: string
): Promise<ProbeResult> {
  const result = await fetchYahooLeaguesReadOnly(env as YahooConnectEnv, userId, correlationId);
  if (result.status === 'not_connected') return { status: 'not_connected' };
  if (result.status === 'error') {
    return {
      status: 'error',
      errorCode: result.errorCode,
      httpStatus: result.httpStatus,
      retryable: result.retryable,
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }

  const leagues: DiscoveredCurrentLeague[] = [];
  for (const league of result.leagues) {
    if (!sports.includes(league.sport) || league.seasonYear !== currentYearBySport[league.sport]) continue;
    const priorLeagueHint = yahooRenewToLeagueKey(league.renew);
    leagues.push({
      sport: league.sport,
      seasonYear: league.seasonYear,
      leagueId: league.leagueKey,
      ...(priorLeagueHint ? { priorLeagueHint } : {}),
    });
  }
  return { status: 'ok', leagues };
}

// =============================================================================
// DIFF (pure)
// =============================================================================

export type PriorMatchBasis = 'same_league_id' | 'previous_league_id' | 'renew_chain' | 'recurring_league_id';

export interface WouldInsertLeague {
  sport: SeasonSport;
  seasonYear: number;
  leagueId: string;
  priorMatch: { leagueId: string; seasonYear: number; basis: PriorMatchBasis } | null;
}

export interface LeagueDiff {
  wouldInsert: WouldInsertLeague[];
  alreadyPresent: number;
}

function findPriorMatch(
  provider: SyncProvider,
  discovered: DiscoveredCurrentLeague,
  stored: StoredLeagueSnapshotRow[]
): WouldInsertLeague['priorMatch'] {
  const priorRows = stored
    .filter((row) => row.sport === discovered.sport && row.seasonYear < discovered.seasonYear)
    .sort((a, b) => b.seasonYear - a.seasonYear);

  for (const row of priorRows) {
    if (provider === 'espn' && row.leagueId === discovered.leagueId) {
      // ESPN league ids are stable across seasons.
      return { leagueId: row.leagueId, seasonYear: row.seasonYear, basis: 'same_league_id' };
    }
    if (discovered.priorLeagueHint && row.leagueId === discovered.priorLeagueHint) {
      return {
        leagueId: row.leagueId,
        seasonYear: row.seasonYear,
        basis: provider === 'yahoo' ? 'renew_chain' : 'previous_league_id',
      };
    }
    if (discovered.priorLeagueHint && row.recurringLeagueId === discovered.priorLeagueHint) {
      return { leagueId: row.leagueId, seasonYear: row.seasonYear, basis: 'recurring_league_id' };
    }
  }
  return null;
}

export function diffDiscoveredAgainstStored(
  provider: SyncProvider,
  discovered: DiscoveredCurrentLeague[],
  stored: StoredLeagueSnapshotRow[]
): LeagueDiff {
  const wouldInsert: WouldInsertLeague[] = [];
  let alreadyPresent = 0;

  for (const league of discovered) {
    const exists = stored.some(
      (row) =>
        row.sport === league.sport &&
        row.seasonYear === league.seasonYear &&
        row.leagueId === league.leagueId
    );
    if (exists) {
      alreadyPresent++;
      continue;
    }
    wouldInsert.push({
      sport: league.sport,
      seasonYear: league.seasonYear,
      leagueId: league.leagueId,
      priorMatch: findPriorMatch(provider, league, stored),
    });
  }

  return { wouldInsert, alreadyPresent };
}

// =============================================================================
// SNAPSHOT QUERIES (select-only)
// =============================================================================

const SNAPSHOT_PAGE_SIZE = 1000;

interface ProviderTableSpec {
  table: string;
  /** Column holding the platform league identifier. */
  idColumn: string;
  hasRecurringColumn: boolean;
}

const PROVIDER_TABLES: Record<SyncProvider, ProviderTableSpec> = {
  espn: { table: 'espn_leagues', idColumn: 'league_id', hasRecurringColumn: false },
  yahoo: { table: 'yahoo_leagues', idColumn: 'league_key', hasRecurringColumn: true },
  sleeper: { table: 'sleeper_leagues', idColumn: 'league_id', hasRecurringColumn: true },
};

async function fetchProviderSnapshot(
  supabase: SupabaseClient,
  provider: SyncProvider,
  sports: SeasonSport[],
  minSeasonYear: number
): Promise<StoredLeagueSnapshotRow[]> {
  const spec = PROVIDER_TABLES[provider];
  const columns = `clerk_user_id, sport, season_year, ${spec.idColumn}${spec.hasRecurringColumn ? ', recurring_league_id' : ''}`;

  const rows: StoredLeagueSnapshotRow[] = [];
  for (let offset = 0; ; offset += SNAPSHOT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from(spec.table)
      .select(columns)
      .in('sport', sports)
      // Bound the scan to last season + current season instead of the full
      // multi-year history: rollover only concerns users active last season,
      // and it keeps snapshot cost proportional to the active base, not to
      // accumulated backfill.
      .gte('season_year', minSeasonYear)
      .order('clerk_user_id', { ascending: true })
      .order(spec.idColumn, { ascending: true })
      .order('season_year', { ascending: true })
      .range(offset, offset + SNAPSHOT_PAGE_SIZE - 1);
    if (error) throw new Error(`Snapshot query failed for ${spec.table}: ${error.message}`);

    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    for (const row of page) {
      rows.push({
        userId: String(row.clerk_user_id),
        sport: String(row.sport),
        seasonYear: Number(row.season_year),
        leagueId: String(row[spec.idColumn]),
        recurringLeagueId: spec.hasRecurringColumn && row.recurring_league_id != null
          ? String(row.recurring_league_id)
          : null,
      });
    }
    if (page.length < SNAPSHOT_PAGE_SIZE) break;
  }
  return rows;
}

// =============================================================================
// RUN ORCHESTRATION
// =============================================================================

export type ReconciliationTrigger = 'cron' | 'manual';

export interface ReconciliationRunSummary {
  runId: string;
  trigger: ReconciliationTrigger;
  outcome: 'completed' | 'budget_exhausted' | 'disabled' | 'refused_not_dry_run' | 'failed';
  dryRun: boolean;
  eligibleUsers: number;
  selectedUsers: number;
  probes: {
    probed: number;
    notConnected: number;
    skippedLease: number;
    skippedBudget: number;
    errors: number;
  };
  wouldInsertTotal: number;
  alreadyPresentTotal: number;
  durationMs: number;
}

function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

function logReconciliation(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: 'league_reconciliation', service: 'auth-worker', ...fields }));
}

async function probeProvider(
  env: ReconciliationEnv,
  candidate: ProviderCandidate,
  currentYearBySport: Record<string, number>,
  correlationId: string
): Promise<ProbeResult> {
  if (candidate.provider === 'espn') {
    return probeEspn(env, candidate.userId, candidate.sports, currentYearBySport);
  }
  if (candidate.provider === 'sleeper') {
    return probeSleeper(env, candidate.userId, candidate.sports, currentYearBySport);
  }
  return probeYahoo(env, candidate.userId, candidate.sports, currentYearBySport, correlationId);
}

export async function runReconciliation(
  env: ReconciliationEnv,
  trigger: ReconciliationTrigger
): Promise<ReconciliationRunSummary> {
  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  const config = parseReconciliationConfig(env);

  const summary: ReconciliationRunSummary = {
    runId,
    trigger,
    outcome: 'completed',
    dryRun: config.dryRun,
    eligibleUsers: 0,
    selectedUsers: 0,
    probes: { probed: 0, notConnected: 0, skippedLease: 0, skippedBudget: 0, errors: 0 },
    wouldInsertTotal: 0,
    alreadyPresentTotal: 0,
    durationMs: 0,
  };

  if (!config.enabled) {
    summary.outcome = 'disabled';
    summary.durationMs = Date.now() - startedAt;
    logReconciliation({ run_id: runId, trigger, status: 'disabled' });
    return summary;
  }
  if (!config.dryRun) {
    // Scheduled writes do not exist yet; a config asking for them is a
    // misconfiguration and the run refuses outright rather than "falling
    // back" to dry-run silently.
    summary.outcome = 'refused_not_dry_run';
    summary.durationMs = Date.now() - startedAt;
    logReconciliation({ run_id: runId, trigger, status: 'refused_not_dry_run' });
    return summary;
  }

  logReconciliation({
    run_id: runId,
    trigger,
    status: 'run_start',
    dry_run: true,
    providers: config.providers,
    sports: config.sports,
    max_users_per_run: config.maxUsersPerRun,
    batch_size: config.batchSize,
    timeout_budget_ms: config.timeoutBudgetMs,
  });

  try {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const syncState = SyncStateStorage.fromEnvironment(env);

    const currentYearBySport: Record<string, number> = Object.fromEntries(
      config.sports.map((sport) => [sport, getDefaultSeasonYear(sport)])
    );

    const minSeasonYear = Math.min(...config.sports.map((sport) => currentYearBySport[sport])) - 1;
    const rowsByProvider: Partial<Record<SyncProvider, StoredLeagueSnapshotRow[]>> = {};
    for (const provider of config.providers) {
      rowsByProvider[provider] = await fetchProviderSnapshot(supabase, provider, config.sports, minSeasonYear);
    }

    const selection = selectCandidates(rowsByProvider, config.sports, currentYearBySport, config.maxUsersPerRun);
    summary.eligibleUsers = selection.eligibleUsers;
    summary.selectedUsers = selection.selectedUsers;

    const deadline = startedAt + config.timeoutBudgetMs;

    const probeCandidate = async (candidate: ProviderCandidate): Promise<void> => {
      const correlationId = crypto.randomUUID();
      const ownerId = crypto.randomUUID();
      const baseFields = {
        run_id: runId,
        trigger,
        correlation_id: correlationId,
        provider: candidate.provider,
        user_id: maskUserId(candidate.userId),
        sports: candidate.sports,
      };

      if (Date.now() >= deadline) {
        summary.probes.skippedBudget++;
        logReconciliation({ ...baseFields, status: 'skipped_budget' });
        return;
      }

      const lease = await syncState.acquireLease(candidate.userId, candidate.provider, ownerId);
      if (!lease.acquired) {
        summary.probes.skippedLease++;
        logReconciliation({
          ...baseFields,
          status: 'skipped_lease',
          lease_state: lease.state,
          retry_after: lease.retryAfterSeconds,
        });
        return;
      }

      const probeStartedAt = Date.now();
      let probe: ProbeResult;
      try {
        probe = await probeProvider(env, candidate, currentYearBySport, correlationId);
      } catch (error) {
        probe = {
          status: 'error',
          errorCode: 'probe_failed',
          retryable: true,
        };
        console.error(
          `[reconciliation] ${candidate.provider} probe threw for ${maskUserId(candidate.userId)}:`,
          error instanceof Error ? error.message : error
        );
      }
      const durationMs = Date.now() - probeStartedAt;

      // Release the lease with attempt-only telemetry: 'skipped' records no
      // last_success_at/last_failure_at, so a dry-run probe never masquerades
      // as a real sync in provider_sync_state. Cooldown is 1s (don't block a
      // user's real refresh behind a probe) unless the provider rate-limited
      // or timed out on us — then the standard upstream backoff protects it,
      // same classification as cooldownSecondsForResult in league-refresh.
      const backoffWorthy =
        probe.status === 'error' && (probe.httpStatus === 429 || probe.errorCode.endsWith('_timeout'));
      await syncState.settle(candidate.userId, candidate.provider, ownerId, {
        status: 'skipped',
        cooldownSeconds: backoffWorthy
          ? Math.max(UPSTREAM_BACKOFF_COOLDOWN_SECONDS, probe.status === 'error' ? probe.retryAfterSeconds ?? 0 : 0)
          : 1,
        syncSource: 'scheduled',
      });

      if (probe.status === 'not_connected') {
        summary.probes.notConnected++;
        logReconciliation({ ...baseFields, status: 'not_connected', duration_ms: durationMs });
        return;
      }
      if (probe.status === 'error') {
        summary.probes.errors++;
        logReconciliation({
          ...baseFields,
          status: 'error',
          error_code: probe.errorCode,
          ...(probe.httpStatus !== undefined ? { http_status: probe.httpStatus } : {}),
          ...(probe.retryable !== undefined ? { retryable: probe.retryable } : {}),
          ...(probe.retryAfterSeconds !== undefined ? { retry_after: probe.retryAfterSeconds } : {}),
          duration_ms: durationMs,
        });
        return;
      }

      const diff = diffDiscoveredAgainstStored(candidate.provider, probe.leagues, candidate.rows);
      summary.probes.probed++;
      summary.wouldInsertTotal += diff.wouldInsert.length;
      summary.alreadyPresentTotal += diff.alreadyPresent;
      logReconciliation({
        ...baseFields,
        status: 'probed',
        would_insert_count: diff.wouldInsert.length,
        already_present_count: diff.alreadyPresent,
        would_insert: diff.wouldInsert.map((league) => ({
          sport: league.sport,
          season_year: league.seasonYear,
          league_id: league.leagueId,
          ...(league.priorMatch
            ? {
                prior_league_id: league.priorMatch.leagueId,
                prior_season_year: league.priorMatch.seasonYear,
                prior_match_basis: league.priorMatch.basis,
              }
            : { prior_match_basis: 'none' }),
        })),
        duration_ms: durationMs,
      });
    };

    for (let i = 0; i < selection.candidates.length; i += config.batchSize) {
      const batch = selection.candidates.slice(i, i + config.batchSize);
      // Isolate candidates: an unexpected throw (probe internals catch their
      // own) must not reject the batch and abandon the remaining candidates.
      await Promise.all(
        batch.map(async (candidate) => {
          try {
            await probeCandidate(candidate);
          } catch (error) {
            summary.probes.errors++;
            logReconciliation({
              run_id: runId,
              trigger,
              provider: candidate.provider,
              user_id: maskUserId(candidate.userId),
              status: 'candidate_failed',
            });
            console.error(
              `[reconciliation] Candidate processing failed for ${candidate.provider}/${maskUserId(candidate.userId)}:`,
              error instanceof Error ? error.message : error
            );
          }
        })
      );
    }

    if (summary.probes.skippedBudget > 0) {
      summary.outcome = 'budget_exhausted';
    }
  } catch (error) {
    summary.outcome = 'failed';
    console.error('[reconciliation] Run failed:', error instanceof Error ? error.message : error);
  }

  summary.durationMs = Date.now() - startedAt;
  logReconciliation({
    run_id: runId,
    trigger,
    status: 'run_end',
    outcome: summary.outcome,
    eligible_users: summary.eligibleUsers,
    selected_users: summary.selectedUsers,
    probed: summary.probes.probed,
    not_connected: summary.probes.notConnected,
    skipped_lease: summary.probes.skippedLease,
    skipped_budget: summary.probes.skippedBudget,
    errors: summary.probes.errors,
    would_insert_total: summary.wouldInsertTotal,
    already_present_total: summary.alreadyPresentTotal,
    duration_ms: summary.durationMs,
  });
  return summary;
}
