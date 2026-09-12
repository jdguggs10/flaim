import { ErrorCode, type EspnCredentials, type SeasonSport } from '@flaim/worker-shared';
import { espnFetch, handleEspnError } from './espn-api';
import { getCurrentSeasonYear } from './season';
import {
  etDateOf,
  findScoringPeriodForDate,
  resolveDateForScoringPeriod,
} from './scoring-period';

export type TransactionType = 'add' | 'drop' | 'trade' | 'waiver' | 'trade_proposal' | 'trade_decline' | 'trade_veto' | 'trade_uphold' | 'failed_bid';

export interface NormalizedTransaction {
  transaction_id: string;
  type: TransactionType;
  status: 'complete' | 'failed' | 'pending' | 'unknown';
  timestamp: number;
  date: string;
  week: number | null;
  provider_scoring_period_id?: number;
  team_ids?: string[];
  players_added?: Array<{ id: string; name?: string; position?: string; team?: string }>;
  players_dropped?: Array<{ id: string; name?: string; position?: string; team?: string }>;
  trade_sides?: Array<{
    team_id: string;
    acquired: Array<{ id: string; name?: string; position?: string; team?: string }>;
    gave_up: Array<{ id: string; name?: string; position?: string; team?: string }>;
  }>;
  faab_bid?: number | null;
}

/**
 * ESPN's lm-api-reads endpoints only serve transactions for the current season;
 * prior-season requests fail with misleading not-found errors, so reject them upfront.
 */
export function assertTransactionsSeasonSupported(sport: SeasonSport, canonicalYear: number): void {
  const currentSeason = getCurrentSeasonYear(sport);
  if (canonicalYear < currentSeason) {
    throw new Error(
      `ESPN_SEASON_NOT_SUPPORTED: ESPN only provides transactions for the current season (season_year=${currentSeason}). Prior-season transaction data is unavailable. Retry with the current season only if the user meant the ongoing season.`
    );
  }
}

export function collectTransactionPlayerIds(txn: NormalizedTransaction): string[] {
  return [
    ...(txn.players_added ?? []).map((p) => p.id),
    ...(txn.players_dropped ?? []).map((p) => p.id),
    ...(txn.trade_sides ?? []).flatMap((side) => [
      ...side.acquired.map((p) => p.id),
      ...side.gave_up.map((p) => p.id),
    ]),
  ];
}

export type TransactionWindowMode = 'explicit_week' | 'recent_two_weeks' | 'preseason';
export type TransactionWindowNormalization = 'none' | 'legacy_scoring_period_to_matchup';
export type TransactionDateBoundsKind = 'exact_contiguous' | 'envelope_non_contiguous' | 'unavailable';

export interface EspnTransactionWindow {
  mode: TransactionWindowMode;
  requestedWeek: number | null;
  normalization: TransactionWindowNormalization;
  matchupPeriodIds: number[];
  scoringPeriodIds: number[];
  scoringToMatchup: Map<number, number>;
  firstScoringPeriodId: number;
  lastScoringPeriodId: number;
  startDate: string | null;
  endDate: string | null;
  dateBoundsKind: TransactionDateBoundsKind;
  timezone: 'America/New_York';
}

export interface EspnTransactionLimitations {
  structured_details_incomplete?: true;
  omitted_unscoped_rows?: number;
  omitted_conflicting_rows?: number;
  exact_date_bounds_unavailable?: true;
  window_coverage_incomplete?: true;
  possibly_truncated?: boolean;
}

export interface EspnTransactionOperationResult {
  window: {
    mode: TransactionWindowMode;
    unit: 'matchup_period';
    requested_week: number | null;
    normalization: TransactionWindowNormalization;
    weeks: number[];
    provider_scoring_period_ids: number[];
    start_date: string | null;
    end_date: string | null;
    date_bounds_kind: TransactionDateBoundsKind;
    timezone: 'America/New_York';
    returned_rows: number;
  };
  // Source values are part of the published get_transactions contract (the
  // gateway outputSchema enumerates exactly these three): pure structured
  // rows, structured rows whose trade sides were filled from the activity
  // feed, and the activity-feed fallback.
  source: 'mTransactions2' | 'mTransactions2_with_activity_trade_details' | 'activity_feed';
  limitations: EspnTransactionLimitations;
  transactions: NormalizedTransaction[];
  teams: Record<string, string>;
  truncated: boolean;
}

const DAILY_SPORTS = new Set<SeasonSport>(['baseball', 'basketball', 'hockey']);
const STRUCTURED_ONLY_TYPES = new Set<TransactionType>([
  'failed_bid',
  'trade_proposal',
  'trade_decline',
  'trade_veto',
  'trade_uphold',
]);
const TRANSACTION_OPERATION_MS = 20_000;
const ENRICHMENT_RESERVE_MS = 4_000;

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function invalidWindow(sport: SeasonSport, requestedWeek: unknown, detail?: string): Error {
  const suffix = detail ? ` ${detail}` : '';
  return new Error(
    `${ErrorCode.INVALID_TRANSACTION_WINDOW}: ESPN ${sport} week is a matchup period. `
      + `Pass a valid current or historical matchup period, pass 0 for preseason, `
      + `or omit week for the current and previous matchup periods.${suffix} `
      + `(received ${String(requestedWeek)})`
  );
}

interface EspnMatchupScoreSide {
  pointsByScoringPeriod?: unknown;
}

interface EspnMatchupScoreEntry {
  matchupPeriodId?: unknown;
  home?: EspnMatchupScoreSide;
  away?: EspnMatchupScoreSide;
}

interface ParsedMatchupScoreSchedule {
  scoringPeriodsByMatchup: Record<number, number[]>;
  scheduledMatchupPeriodIds: number[];
}

/**
 * Build the daily scoring-period membership of each matchup from the score
 * schedule. ESPN's scheduleSettings.matchupPeriods field is a different
 * weekly/playoff grouping and cannot be used for this purpose.
 */
function parseMatchupScoreSchedule(raw: unknown): ParsedMatchupScoreSchedule {
  if (!Array.isArray(raw)) {
    throw new Error(
      `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN mMatchupScore schedule was missing or malformed`
    );
  }

  const periodsByMatchup = new Map<number, Set<number>>();
  const scheduledMatchupPeriodIds = new Set<number>();
  const ownerByScoringPeriod = new Map<number, number>();
  for (const rawEntry of raw) {
    if (rawEntry === null || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      throw new Error(
        `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN mMatchupScore schedule contained a malformed entry`
      );
    }

    const entry = rawEntry as EspnMatchupScoreEntry;
    const matchupId = entry.matchupPeriodId;
    if (!isNonNegativeInteger(matchupId)) {
      throw new Error(
        `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN mMatchupScore schedule contained an invalid matchup period`
      );
    }
    scheduledMatchupPeriodIds.add(matchupId);

    const periods = periodsByMatchup.get(matchupId) ?? new Set<number>();
    for (const side of [entry.home, entry.away]) {
      const rawPoints = side?.pointsByScoringPeriod;
      if (rawPoints === undefined || rawPoints === null) continue;
      if (typeof rawPoints !== 'object' || Array.isArray(rawPoints)) {
        throw new Error(
          `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN mMatchupScore schedule contained malformed scoring-period points`
        );
      }

      for (const rawPeriod of Object.keys(rawPoints)) {
        const scoringPeriodId = Number(rawPeriod);
        if (
          !isNonNegativeInteger(scoringPeriodId)
          || String(scoringPeriodId) !== rawPeriod
        ) {
          throw new Error(
            `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN mMatchupScore schedule contained an invalid scoring period`
          );
        }
        const existingOwner = ownerByScoringPeriod.get(scoringPeriodId);
        if (existingOwner !== undefined && existingOwner !== matchupId) {
          throw new Error(
            `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN scoring period ${scoringPeriodId} belonged to multiple matchup periods`
          );
        }
        ownerByScoringPeriod.set(scoringPeriodId, matchupId);
        periods.add(scoringPeriodId);
      }
    }
    if (periods.size > 0) periodsByMatchup.set(matchupId, periods);
  }

  const parsed: Record<number, number[]> = {};
  for (const [matchupId, periods] of periodsByMatchup) {
    parsed[matchupId] = [...periods].sort((a, b) => a - b);
  }
  return {
    scoringPeriodsByMatchup: parsed,
    scheduledMatchupPeriodIds: [...scheduledMatchupPeriodIds].sort((a, b) => a - b),
  };
}

export function parseMatchupScoringPeriods(raw: unknown): Record<number, number[]> {
  return parseMatchupScoreSchedule(raw).scoringPeriodsByMatchup;
}

function scoringMap(matchupPeriods: Record<number, number[]>): Map<number, number> {
  const map = new Map<number, number>();
  for (const [matchupKey, periods] of Object.entries(matchupPeriods)) {
    const matchupId = Number(matchupKey);
    for (const period of periods) map.set(period, matchupId);
  }
  return map;
}

function areContiguous(periods: number[]): boolean {
  return periods.every((period, index) => index === 0 || period === periods[index - 1] + 1);
}

export interface EspnPlayerBasic {
  fullName?: string;
  defaultPositionId?: number;
  proTeamId?: number;
}

interface EspnActivityMessage {
  id?: number;
  messageTypeId?: number;
  targetId?: number;
  from?: number;
  to?: number;
  for?: number;
  date?: number;
  scoringPeriodId?: number;
  matchupPeriodId?: number;
}

interface EspnActivityTopic {
  id?: number;
  date?: number;
  scoringPeriodId?: number;
  matchupPeriodId?: number;
  messages?: EspnActivityMessage[];
}

interface EspnActivityResponse {
  topics?: EspnActivityTopic[];
}

interface TradeMovement {
  playerId: string;
  fromTeamId: string;
  toTeamId: string;
}

// ---------------------------------------------------------------------------
// mTransactions2 response types
// ---------------------------------------------------------------------------

interface EspnMTransactionItem {
  fromTeamId?: number;
  playerId?: number;
  toTeamId?: number;
  type?: string; // "ADD" | "DROP"
}

interface EspnMTransaction {
  id?: number;
  bidAmount?: number;
  executionType?: string;
  isPending?: boolean;
  items?: EspnMTransactionItem[];
  memberId?: number;
  proposedDate?: number;
  processDate?: number;
  scoringPeriodId?: number;
  status?: string;
  subOrder?: number;
  teamId?: number;
  type?: string; // "WAIVER" | "WAIVER_ERROR" | "FREEAGENT" | "TRADE_ACCEPT" | "TRADE_UPHOLD" | "TRADE_PROPOSAL" | "TRADE_DECLINE" | "TRADE_VETO"
}

interface EspnMTransactions2Response {
  transactions?: EspnMTransaction[];
}

export type { EspnMTransaction };

// ---------------------------------------------------------------------------
// mTransactions2 normalizer
// ---------------------------------------------------------------------------

function toTxnTypeFromMTransaction(type?: string): TransactionType | null {
  if (!type) return null;
  switch (type) {
    case 'FREEAGENT': return 'add';
    case 'WAIVER': return 'waiver';
    case 'WAIVER_ERROR': return 'failed_bid';
    case 'TRADE_ACCEPT': return 'trade';
    case 'TRADE_UPHOLD': return 'trade_uphold';
    case 'TRADE_PROPOSAL': return 'trade_proposal';
    case 'TRADE_DECLINE': return 'trade_decline';
    case 'TRADE_VETO': return 'trade_veto';
    default: return null;
  }
}

function toStatus(type: TransactionType, rawStatus?: string): 'complete' | 'failed' | 'pending' | 'unknown' {
  if (type === 'failed_bid') return 'failed';
  if (type === 'trade_proposal') return 'pending';
  if (rawStatus === 'EXECUTED') return 'complete';
  if (rawStatus?.startsWith('FAILED')) return 'failed';
  if (rawStatus === 'PENDING') return 'pending';
  return 'unknown';
}

export function normalizeMTransactions2(
  transactions: EspnMTransaction[],
  windowOrWeeks?: EspnTransactionWindow | number[],
): NormalizedTransaction[] {
  const window = windowOrWeeks === undefined ? null : coerceTransactionWindow(windowOrWeeks);
  const out: NormalizedTransaction[] = [];
  const requestedMatchups = new Set(window?.matchupPeriodIds ?? []);

  for (const txn of transactions) {
    const rawType = toTxnTypeFromMTransaction(txn.type);
    if (!rawType) continue;
    const scoringPeriodId = txn.scoringPeriodId;
    if (!isNonNegativeInteger(scoringPeriodId)) continue;
    const mappedMatchupPeriodId = window?.scoringToMatchup.get(scoringPeriodId);
    if (window && mappedMatchupPeriodId === undefined) continue;
    const matchupPeriodId = mappedMatchupPeriodId ?? scoringPeriodId;
    if (window && !requestedMatchups.has(matchupPeriodId)) continue;

    const added: Array<{ id: string }> = [];
    const dropped: Array<{ id: string }> = [];

    for (const item of txn.items ?? []) {
      if (!item.playerId) continue;
      const pid = String(item.playerId);
      if (item.type === 'ADD' && item.toTeamId !== -1) {
        added.push({ id: pid });
      }
      if (item.type === 'DROP' || (item.type === 'ADD' && item.toTeamId === -1)) {
        dropped.push({ id: pid });
      }
    }

    const timestamp = txn.processDate ?? txn.proposedDate ?? 0;

    // Directional trade detail from structured movement items (FLA-140):
    // each item on a resolved trade carries the player's from/to team ids,
    // which is exactly the movement data the activity-feed fallback has to
    // reconstruct by matching. Only rows where every populated item resolves
    // get sides; partial movement data leaves sides absent so the activity
    // merge can fill them instead of us emitting a half-directional trade.
    let tradeSides: NormalizedTransaction['trade_sides'];
    if (rawType === 'trade' || rawType === 'trade_uphold') {
      const items = (txn.items ?? []).filter((item) => item.playerId);
      const movements: TradeMovement[] = [];
      for (const item of items) {
        if (
          typeof item.fromTeamId === 'number' && item.fromTeamId > 0
          && typeof item.toTeamId === 'number' && item.toTeamId > 0
        ) {
          movements.push({
            playerId: String(item.playerId),
            fromTeamId: String(item.fromTeamId),
            toTeamId: String(item.toTeamId),
          });
        }
      }
      if (movements.length > 0 && movements.length === items.length) {
        tradeSides = buildTradeSides(movements);
      }
    }

    const teamIds = tradeSides
      ? tradeSides.map((side) => side.team_id)
      : (txn.teamId ? [String(txn.teamId)] : []);

    // ESPN marks standalone free-agent drops as FREEAGENT with only drop items.
    const type: TransactionType = rawType === 'add' && added.length === 0 && dropped.length > 0
      ? 'drop'
      : rawType;

    out.push({
      transaction_id: String(txn.id ?? `mtx-${timestamp}`),
      type,
      status: toStatus(type, txn.status),
      timestamp,
      date: etDateOf(timestamp),
      week: matchupPeriodId,
      provider_scoring_period_id: scoringPeriodId,
      team_ids: teamIds.length > 0 ? teamIds : undefined,
      players_added: added,
      players_dropped: dropped,
      trade_sides: tradeSides,
      faab_bid: typeof txn.bidAmount === 'number' ? txn.bidAmount : null,
    });
  }

  return out.sort((a, b) => b.timestamp - a.timestamp);
}

// ---------------------------------------------------------------------------
// mTransactions2 fetch function
// ---------------------------------------------------------------------------

const MTRANSACTIONS2_TYPES = [
  'WAIVER', 'WAIVER_ERROR', 'FREEAGENT',
  'TRADE_ACCEPT', 'TRADE_UPHOLD', 'TRADE_PROPOSAL', 'TRADE_DECLINE', 'TRADE_VETO',
];

// ESPN rejects in-filter pagination on mTransactions2: any `limit`/`offset`
// in the x-fantasy-filter (with or without sort fields) returns HTTP 400 on
// every request. The minimal filterType-only shape below is the accepted
// form (matching community ESPN clients). The response for a pinned
// scoringPeriodId is ESPN's own full result set for that period; the view
// exposes no way to page it.
const MTRANSACTIONS2_CONCURRENCY = 4;

export interface MTransactions2Result {
  transactions: NormalizedTransaction[];
}

/**
 * espnFetch's abort timer only covers the wait for response headers — it is
 * cleared the moment fetch() resolves. A provider that stalls while streaming
 * the JSON body would otherwise hold the structured attempt past its
 * sub-deadline and starve the activity fallback, so the body read races the
 * remaining budget independently.
 */
async function readJsonWithDeadline<T>(res: Response, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error(
      `${ErrorCode.ESPN_TIMEOUT}: ESPN structured transactions exceeded the operation budget`
    );
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      res.json() as Promise<T>,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(
            `${ErrorCode.ESPN_TIMEOUT}: ESPN structured transaction body read timed out`
          ));
        }, remaining);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function fetchEspnMTransactions2(
  gameId: string,
  leagueId: string,
  seasonYear: number,
  credentials: EspnCredentials,
  windowOrWeeks: EspnTransactionWindow | number[],
  deadline?: number,
): Promise<MTransactions2Result> {
  const window = coerceTransactionWindow(windowOrWeeks);
  const effectiveDeadline = deadline ?? Date.now() + TRANSACTION_OPERATION_MS;

  const fetchScoringPeriod = async (scoringPeriodId: number): Promise<EspnMTransaction[]> => {
    const remaining = effectiveDeadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `${ErrorCode.ESPN_TIMEOUT}: ESPN structured transactions exceeded the operation budget`
      );
    }
    const path = `/seasons/${seasonYear}/segments/0/leagues/${leagueId}?view=mTransactions2&scoringPeriodId=${scoringPeriodId}`;
    const headers = {
      'x-fantasy-filter': JSON.stringify({
        transactions: {
          filterType: { value: MTRANSACTIONS2_TYPES },
        },
      }),
    };
    const res = await espnFetch(path, gameId, {
      credentials,
      timeout: Math.max(1, Math.min(7000, remaining)),
      headers,
    });
    if (!res.ok) handleEspnError(res);
    const body = await readJsonWithDeadline<EspnMTransactions2Response>(res, effectiveDeadline);
    return body.transactions ?? [];
  };

  // All-or-nothing across the window's scoring periods: a partially covered
  // window is indistinguishable from a quiet one, so any per-period failure
  // aborts the structured source and the caller falls back to the activity
  // feed instead of serving silent gaps. Daily-sport windows can span many
  // scoring periods, so requests run in small concurrent batches.
  const raw: EspnMTransaction[] = [];
  const periods = [...window.scoringPeriodIds];
  for (let start = 0; start < periods.length; start += MTRANSACTIONS2_CONCURRENCY) {
    const chunk = periods.slice(start, start + MTRANSACTIONS2_CONCURRENCY);
    const results = await Promise.all(chunk.map(fetchScoringPeriod));
    for (const rows of results) raw.push(...rows);
  }

  const seen = new Set<string>();
  const all: NormalizedTransaction[] = [];
  for (const txn of normalizeMTransactions2(raw, window)) {
    if (!seen.has(txn.transaction_id)) {
      seen.add(txn.transaction_id);
      all.push(txn);
    }
  }

  return { transactions: all };
}

function coerceTransactionWindow(
  windowOrWeeks?: EspnTransactionWindow | number[],
): EspnTransactionWindow {
  const weeks = Array.isArray(windowOrWeeks) ? windowOrWeeks : [0];
  if (!Array.isArray(windowOrWeeks)) {
    return windowOrWeeks ?? {
      mode: 'preseason',
      requestedWeek: 0,
      normalization: 'none',
      matchupPeriodIds: [0],
      scoringPeriodIds: [0],
      scoringToMatchup: new Map([[0, 0]]),
      firstScoringPeriodId: 0,
      lastScoringPeriodId: 0,
      startDate: null,
      endDate: null,
      dateBoundsKind: 'unavailable',
      timezone: 'America/New_York',
    };
  }
  // Legacy helper/test compatibility only. Production handlers must pass a
  // fully resolved window; FLA-140 must preserve that boundary when restoring
  // mTransactions2 so daily scoring periods cannot become public matchups.
  const uniqueWeeks = [...new Set(weeks)];
  return {
    mode: uniqueWeeks.length === 1 && uniqueWeeks[0] === 0
      ? 'preseason'
      : (uniqueWeeks.length === 1 ? 'explicit_week' : 'recent_two_weeks'),
    requestedWeek: uniqueWeeks.length === 1 ? uniqueWeeks[0] : null,
    normalization: 'none',
    matchupPeriodIds: uniqueWeeks,
    scoringPeriodIds: uniqueWeeks,
    scoringToMatchup: new Map(uniqueWeeks.map((week) => [week, week])),
    firstScoringPeriodId: Math.min(...uniqueWeeks),
    lastScoringPeriodId: Math.max(...uniqueWeeks),
    startDate: null,
    endDate: null,
    dateBoundsKind: 'unavailable',
    timezone: 'America/New_York',
  };
}

// ---------------------------------------------------------------------------
// Trade player detail fallback via activity feed
// ---------------------------------------------------------------------------

const TRADE_TYPES: TransactionType[] = ['trade', 'trade_uphold'];

export function mergeTradePlayerDetails(
  mTxns: NormalizedTransaction[],
  activityTxns: NormalizedTransaction[],
): NormalizedTransaction[] {
  // The activity feed labels raw trade movements as "trade"; mTransactions2 can
  // label resolved rows as "trade_uphold". Timestamp/team matching bridges them.
  const activityTrades = activityTxns.filter((t) => t.type === 'trade');
  const used = new Set<number>();

  return mTxns.map((txn) => {
    if (!TRADE_TYPES.includes(txn.type)) return txn;

    // A trade is complete only when it has directional sides. Rows with flat
    // players_added/players_dropped but no sides ("mixed completeness",
    // FLA-140) still take the activity-feed sides; their own flat lists are
    // preserved rather than overwritten.
    const hasSides = (txn.trade_sides ?? []).some(
      (side) => side.acquired.length > 0 || side.gave_up.length > 0,
    );
    if (hasSides) return txn;

    const hasFlatPlayers =
      (txn.players_added?.length ?? 0) > 0 || (txn.players_dropped?.length ?? 0) > 0;

    const txnTeams = new Set(txn.team_ids ?? []);
    const matchIdx = activityTrades.findIndex((at, idx) => {
      if (used.has(idx)) return false;
      if (Math.abs(at.timestamp - txn.timestamp) >= 60_000) return false;
      // Require at least one overlapping team ID when both sides have team info
      if (txnTeams.size > 0 && at.team_ids?.length) {
        return at.team_ids.some((id) => txnTeams.has(id));
      }
      return true;
    });
    if (matchIdx === -1) return txn;

    used.add(matchIdx);
    const match = activityTrades[matchIdx];

    return {
      ...txn,
      players_added: hasFlatPlayers ? txn.players_added : match.players_added,
      players_dropped: hasFlatPlayers ? txn.players_dropped : match.players_dropped,
      trade_sides: match.trade_sides,
      team_ids: match.team_ids?.length ? match.team_ids : txn.team_ids,
    };
  });
}

const ACTIVITY_MESSAGE_IDS = [178, 180, 179, 239, 181, 244];

function toTxnTypeFromMessageId(messageTypeId?: number): TransactionType | null {
  if (!messageTypeId) return null;
  if (messageTypeId === 178) return 'add';
  if (messageTypeId === 180) return 'waiver';
  if (messageTypeId === 179 || messageTypeId === 181 || messageTypeId === 239) return 'drop';
  if (messageTypeId === 244) return 'trade';
  return null;
}

type ActivityMembership =
  | { kind: 'matched'; matchupPeriodId: number; scoringPeriodId?: number }
  | { kind: 'outside' }
  | { kind: 'unscoped' }
  | { kind: 'timeout' }
  | { kind: 'conflict' };

interface ActivityNormalizationResult {
  transaction: NormalizedTransaction | null;
  omission: 'unscoped' | 'conflict' | null;
  coverageIncomplete?: true;
}

function selectMessageThenTopic(
  messageValue: unknown,
  topicValue: unknown,
): { value: number | null; conflict: boolean } {
  const messageId = isNonNegativeInteger(messageValue) ? messageValue : null;
  const topicId = isNonNegativeInteger(topicValue) ? topicValue : null;
  if (messageId !== null && topicId !== null && messageId !== topicId) {
    return { value: null, conflict: true };
  }
  return { value: messageId ?? topicId, conflict: false };
}

async function resolveActivityMembership(
  gameId: string,
  seasonYear: number,
  sport: SeasonSport,
  window: EspnTransactionWindow,
  topic: EspnActivityTopic,
  message: EspnActivityMessage,
  timeout: number,
): Promise<ActivityMembership> {
  const matchupEvidence = selectMessageThenTopic(
    message.matchupPeriodId,
    topic.matchupPeriodId,
  );
  const scoringEvidence = selectMessageThenTopic(
    message.scoringPeriodId,
    topic.scoringPeriodId,
  );
  if (matchupEvidence.conflict || scoringEvidence.conflict) {
    return { kind: 'conflict' };
  }

  let matchupPeriodId = matchupEvidence.value;
  const scoringPeriodId = scoringEvidence.value;
  if (scoringPeriodId !== null) {
    const mappedMatchup = window.scoringToMatchup.get(scoringPeriodId);
    if (mappedMatchup === undefined) return { kind: 'unscoped' };
    if (matchupPeriodId !== null && matchupPeriodId !== mappedMatchup) {
      return { kind: 'conflict' };
    }
    matchupPeriodId = matchupPeriodId ?? mappedMatchup;
  }

  if (matchupPeriodId === null && DAILY_SPORTS.has(sport)) {
    const timestamp = message.date ?? topic.date;
    if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) {
      let inferredScoringPeriod: number | null;
      try {
        inferredScoringPeriod = await findScoringPeriodForDate(
          gameId,
          seasonYear,
          etDateOf(timestamp),
          timeout,
        );
      } catch (error) {
        if (
          error instanceof Error
          && error.message.startsWith(`${ErrorCode.ESPN_TIMEOUT}:`)
        ) {
          return { kind: 'timeout' };
        }
        throw error;
      }
      if (inferredScoringPeriod !== null) {
        const mappedMatchup = window.scoringToMatchup.get(inferredScoringPeriod);
        if (mappedMatchup !== undefined) {
          matchupPeriodId = mappedMatchup;
          if (!window.matchupPeriodIds.includes(matchupPeriodId)) return { kind: 'outside' };
          return {
            kind: 'matched',
            matchupPeriodId,
            scoringPeriodId: inferredScoringPeriod,
          };
        }
      }
    }
  }

  if (matchupPeriodId === null) return { kind: 'unscoped' };
  if (!window.matchupPeriodIds.includes(matchupPeriodId)) return { kind: 'outside' };
  return {
    kind: 'matched',
    matchupPeriodId,
    scoringPeriodId: scoringPeriodId ?? undefined,
  };
}

function getTeamIds(messageTypeId: number, message: EspnActivityMessage): string[] {
  const set = new Set<string>();
  if (messageTypeId === 244) {
    if (typeof message.from === 'number' && message.from > 0) set.add(String(message.from));
    if (typeof message.to === 'number' && message.to > 0) set.add(String(message.to));
  } else if (messageTypeId === 239) {
    if (typeof message.for === 'number' && message.for > 0) set.add(String(message.for));
  } else {
    if (typeof message.to === 'number' && message.to > 0) set.add(String(message.to));
    if (typeof message.for === 'number' && message.for > 0) set.add(String(message.for));
  }
  return Array.from(set);
}

function buildTradeSides(movements: TradeMovement[]): NonNullable<NormalizedTransaction['trade_sides']> {
  const teamIds = new Set<string>();
  for (const movement of movements) {
    teamIds.add(movement.fromTeamId);
    teamIds.add(movement.toTeamId);
  }

  return Array.from(teamIds).sort((a, b) => Number(a) - Number(b)).map((teamId) => ({
    team_id: teamId,
    acquired: movements
      .filter((movement) => movement.toTeamId === teamId)
      .map((movement) => ({ id: movement.playerId })),
    gave_up: movements
      .filter((movement) => movement.fromTeamId === teamId)
      .map((movement) => ({ id: movement.playerId })),
  }));
}

async function normalizeTradeTopic(
  gameId: string,
  seasonYear: number,
  sport: SeasonSport,
  topic: EspnActivityTopic,
  window: EspnTransactionWindow,
  timeout: number,
): Promise<ActivityNormalizationResult> {
  const messages = topic.messages ?? [];
  const rawTradeMessages = messages.filter((message) => message.messageTypeId === 244);
  const tradeMessages = rawTradeMessages.filter(
    (msg) =>
      msg.messageTypeId === 244 &&
      msg.targetId !== undefined &&
      typeof msg.from === 'number' &&
      msg.from > 0 &&
      typeof msg.to === 'number' &&
      msg.to > 0,
  );
  if (rawTradeMessages.length === 0) return { transaction: null, omission: null };
  if (tradeMessages.length !== rawTradeMessages.length) {
    return { transaction: null, omission: 'unscoped' };
  }

  const memberships = await Promise.all(
    tradeMessages.map((message) => resolveActivityMembership(
      gameId,
      seasonYear,
      sport,
      window,
      topic,
      message,
      timeout,
    )),
  );
  if (memberships.some((membership) => membership.kind === 'conflict')) {
    return { transaction: null, omission: 'conflict' };
  }
  if (memberships.some((membership) => membership.kind === 'timeout')) {
    return {
      transaction: null,
      omission: 'unscoped',
      coverageIncomplete: true,
    };
  }
  if (memberships.some((membership) => membership.kind === 'unscoped')) {
    return { transaction: null, omission: 'unscoped' };
  }
  const matched = memberships.filter(
    (membership): membership is Extract<ActivityMembership, { kind: 'matched' }> =>
      membership.kind === 'matched',
  );
  if (matched.length === 0) return { transaction: null, omission: null };
  if (matched.length !== memberships.length) {
    // A trade whose legs cross the requested window is outside that aggregate,
    // not proof that ESPN supplied contradictory scope evidence.
    return { transaction: null, omission: null };
  }
  if (new Set(matched.map((membership) => membership.matchupPeriodId)).size !== 1) {
    return { transaction: null, omission: 'conflict' };
  }

  const timestamp = tradeMessages[0].date ?? topic.date ?? 0;
  const movements = tradeMessages.map((msg) => ({
    playerId: String(msg.targetId),
    fromTeamId: String(msg.from),
    toTeamId: String(msg.to),
  }));
  const tradeSides = buildTradeSides(movements);
  const teamIds = tradeSides.map((side) => side.team_id);
  const providerScoringPeriods = new Set(
    matched.flatMap((membership) =>
      membership.scoringPeriodId === undefined ? [] : [membership.scoringPeriodId]
    ),
  );

  return {
    omission: null,
    transaction: {
      transaction_id: String(topic.id ?? `trade-${timestamp}-${teamIds.join('-')}`),
      type: 'trade',
      status: 'complete',
      timestamp,
      date: etDateOf(timestamp),
      week: matched[0].matchupPeriodId,
      provider_scoring_period_id:
        providerScoringPeriods.size === 1 ? [...providerScoringPeriods][0] : undefined,
      team_ids: teamIds,
      players_added: [],
      players_dropped: [],
      trade_sides: tradeSides,
      faab_bid: null,
    },
  };
}

export interface EspnLeagueContext {
  scoringPeriodId: number;
  currentMatchupPeriod: number;
  matchupPeriods: Record<number, number[]>;
  scheduledMatchupPeriodIds: number[];
  teams: Record<string, string>;
}

export async function getEspnLeagueContext(
  gameId: string,
  leagueId: string,
  seasonYear: number,
  credentials: EspnCredentials,
  timeout = 7000,
): Promise<EspnLeagueContext> {
  const views = gameId === 'ffl'
    ? 'view=mSettings&view=mTeam'
    : 'view=mMatchupScore&view=mSettings&view=mTeam';
  const path = `/seasons/${seasonYear}/segments/0/leagues/${leagueId}?${views}`;
  const res = await espnFetch(path, gameId, { credentials, timeout });
  if (!res.ok) handleEspnError(res);
  const data = await res.json() as {
    scoringPeriodId?: number;
    currentMatchupPeriod?: number;
    status?: { currentMatchupPeriod?: number };
    schedule?: unknown;
    teams?: Array<{ id: number; location?: string; nickname?: string; name?: string }>;
  };
  const scoringPeriodId = data.scoringPeriodId;
  const currentMatchupPeriod =
    data.currentMatchupPeriod ?? data.status?.currentMatchupPeriod;
  if (!isNonNegativeInteger(scoringPeriodId) || !isNonNegativeInteger(currentMatchupPeriod)) {
    throw new Error(
      `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN league context omitted a valid current scoring or matchup period`
    );
  }

  const teams: Record<string, string> = {};
  for (const t of data.teams ?? []) {
    teams[String(t.id)] = t.location && t.nickname
      ? `${t.location} ${t.nickname}`
      : t.name || `Team ${t.id}`;
  }
  const isDailyPreseasonWithoutSchedule =
    gameId !== 'ffl'
    && scoringPeriodId === 0
    && currentMatchupPeriod === 0
    && (data.schedule === undefined || data.schedule === null);
  const parsedSchedule = gameId === 'ffl' || isDailyPreseasonWithoutSchedule
    ? { scoringPeriodsByMatchup: {}, scheduledMatchupPeriodIds: [] }
    : parseMatchupScoreSchedule(data.schedule);
  const matchupPeriods = parsedSchedule.scoringPeriodsByMatchup;
  if (gameId !== 'ffl' && scoringPeriodId > 0 && currentMatchupPeriod > 0) {
    const currentOwner = scoringMap(matchupPeriods).get(scoringPeriodId);
    if (currentOwner !== undefined && currentOwner !== currentMatchupPeriod) {
      throw new Error(
        `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN current scoring period belonged to a different matchup period`
      );
    }
    if (currentOwner === undefined) {
      matchupPeriods[currentMatchupPeriod] = [
        ...new Set([
          ...(matchupPeriods[currentMatchupPeriod] ?? []),
          scoringPeriodId,
        ]),
      ].sort((a, b) => a - b);
    }
  }
  return {
    scoringPeriodId,
    currentMatchupPeriod,
    matchupPeriods,
    scheduledMatchupPeriodIds: parsedSchedule.scheduledMatchupPeriodIds,
    teams,
  };
}

interface ResolveTransactionWindowInput {
  gameId: string;
  seasonYear: number;
  sport: SeasonSport;
  context: EspnLeagueContext;
  requestedWeek?: number;
  timeout?: number;
}

export async function resolveEspnTransactionWindow({
  gameId,
  seasonYear,
  sport,
  context,
  requestedWeek,
  timeout = 7000,
}: ResolveTransactionWindowInput): Promise<EspnTransactionWindow> {
  if (requestedWeek !== undefined && !isNonNegativeInteger(requestedWeek)) {
    throw invalidWindow(sport, requestedWeek);
  }
  if (!isNonNegativeInteger(context.currentMatchupPeriod)) {
    throw new Error(
      `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN league context omitted a valid current matchup period`
    );
  }
  const currentMatchupPeriod = context.currentMatchupPeriod;

  const requested = requestedWeek ?? null;
  let normalization: TransactionWindowNormalization = 'none';
  let matchupPeriodIds: number[];
  let scoringPeriodIds: number[];
  let scoringToMatchup: Map<number, number>;

  if (sport === 'football') {
    if (requested !== null && requested > currentMatchupPeriod) {
      throw invalidWindow(sport, requested);
    }
    matchupPeriodIds = requested !== null
      ? [requested]
      : [...new Set([
          currentMatchupPeriod,
          Math.max(0, currentMatchupPeriod - 1),
        ])];
    scoringPeriodIds = [...matchupPeriodIds];
    // Football scoring periods and matchup periods are identical. Keep the
    // full current/historical identity map so normal feed rows outside the
    // requested window are classified as outside, not falsely as unscoped.
    scoringToMatchup = new Map(
      Array.from(
        { length: currentMatchupPeriod + 1 },
        (_, period) => [period, period] as const,
      ),
    );
  } else {
    const matchupPeriods = context.matchupPeriods;
    scoringToMatchup = scoringMap(matchupPeriods);
    const mappedCurrentScoringPeriod = scoringToMatchup.get(context.scoringPeriodId);
    // Real provider contexts fail this invariant in getEspnLeagueContext.
    // Keep the warning for direct pure-resolver callers and hand-built tests.
    if (
      mappedCurrentScoringPeriod !== undefined
      && mappedCurrentScoringPeriod !== currentMatchupPeriod
    ) {
      console.warn(
        `[transaction-window] current_period_context_mismatch sport=${sport}`,
      );
    }
    const usablePeriodsForMatchup = (matchupId: number): number[] => {
      if (matchupId === 0) return [0];
      const periods = matchupPeriods[matchupId] ?? [];
      return matchupId === currentMatchupPeriod
        ? periods.filter((period) => period <= context.scoringPeriodId)
        : periods;
    };

    if (requested !== null) {
      const directPeriods = requested <= currentMatchupPeriod
        ? usablePeriodsForMatchup(requested)
        : [];
      if (directPeriods.length > 0) {
        matchupPeriodIds = [requested];
        scoringPeriodIds = directPeriods;
      } else {
        if (context.scheduledMatchupPeriodIds.includes(requested)) {
          const explanation = requested > currentMatchupPeriod
            ? 'That matchup period exists in the ESPN schedule but has not begun.'
            : 'ESPN did not provide scoring-period membership for that scheduled matchup.';
          throw invalidWindow(
            sport,
            requested,
            explanation,
          );
        }
        const legacyMatchup = scoringToMatchup.get(requested);
        const legacyPeriods = legacyMatchup === undefined
          || legacyMatchup > currentMatchupPeriod
          ? []
          : usablePeriodsForMatchup(legacyMatchup);
        if (legacyMatchup === undefined || legacyPeriods.length === 0) {
          throw invalidWindow(sport, requested);
        }
        matchupPeriodIds = [legacyMatchup];
        scoringPeriodIds = legacyPeriods;
        normalization = 'legacy_scoring_period_to_matchup';
        console.info(
          `[transaction-window] legacy_scoring_period_normalized sport=${sport}`,
        );
      }
    } else {
      matchupPeriodIds = [...new Set([
        currentMatchupPeriod,
        Math.max(0, currentMatchupPeriod - 1),
      ])];
      const missingMatchup = matchupPeriodIds.find(
        (matchupId) => usablePeriodsForMatchup(matchupId).length === 0,
      );
      if (missingMatchup !== undefined) {
        throw new Error(
          `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN mMatchupScore schedule contained no scoring periods for matchup period ${missingMatchup}`
        );
      }
      scoringPeriodIds = matchupPeriodIds.flatMap(usablePeriodsForMatchup);
    }

    scoringPeriodIds = [...new Set(scoringPeriodIds)].sort((a, b) => a - b);
    for (const matchupId of matchupPeriodIds) {
      if (matchupId === 0) scoringToMatchup.set(0, 0);
    }
  }

  const firstScoringPeriodId = scoringPeriodIds[0];
  const lastScoringPeriodId = scoringPeriodIds[scoringPeriodIds.length - 1];
  let startDate: string | null = null;
  let endDate: string | null = null;
  let dateBoundsKind: TransactionDateBoundsKind = 'unavailable';

  if (DAILY_SPORTS.has(sport) && !scoringPeriodIds.includes(0)) {
    const dateResolutionDeadline = Date.now() + timeout;
    startDate = await resolveDateForScoringPeriod(
      gameId,
      seasonYear,
      firstScoringPeriodId,
      timeout,
    );
    if (firstScoringPeriodId === lastScoringPeriodId) {
      endDate = startDate;
    } else {
      const remaining = dateResolutionDeadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `${ErrorCode.ESPN_TIMEOUT}: ESPN transaction window date resolution exceeded its budget`
        );
      }
      endDate = await resolveDateForScoringPeriod(
        gameId,
        seasonYear,
        lastScoringPeriodId,
        remaining,
      );
    }
    dateBoundsKind = areContiguous(scoringPeriodIds)
      ? 'exact_contiguous'
      : 'envelope_non_contiguous';
  } else if (DAILY_SPORTS.has(sport)) {
    const positivePeriods = scoringPeriodIds.filter((period) => period > 0);
    if (positivePeriods.length > 0) {
      endDate = await resolveDateForScoringPeriod(
        gameId,
        seasonYear,
        positivePeriods[positivePeriods.length - 1],
        timeout,
      );
    }
  }

  return {
    mode: requested !== null
      ? (requested === 0 ? 'preseason' : 'explicit_week')
      : (matchupPeriodIds.every((matchupId) => matchupId === 0)
          ? 'preseason'
          : 'recent_two_weeks'),
    requestedWeek: requested,
    normalization,
    matchupPeriodIds,
    scoringPeriodIds,
    scoringToMatchup,
    firstScoringPeriodId,
    lastScoringPeriodId,
    startDate,
    endDate,
    dateBoundsKind,
    timezone: 'America/New_York',
  };
}

export interface ActivityTransactionsResult {
  transactions: NormalizedTransaction[];
  omittedUnscopedRows: number;
  omittedConflictingRows: number;
  coverageIncomplete: boolean;
}

export async function fetchEspnTransactionsByWindow(
  gameId: string,
  leagueId: string,
  seasonYear: number,
  sport: SeasonSport,
  credentials: EspnCredentials,
  window: EspnTransactionWindow,
  deadline: number,
): Promise<ActivityTransactionsResult> {
  const pageSize = 25;
  const maxPages = 8;
  const seen = new Set<string>();
  const out: NormalizedTransaction[] = [];
  let omittedUnscopedRows = 0;
  let omittedConflictingRows = 0;
  let exhausted = false;
  let coverageProven = false;
  let membershipCoverageIncomplete = false;

  for (let page = 0; page < maxPages; page += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const offset = page * pageSize;
    const path = `/seasons/${seasonYear}/segments/0/leagues/${leagueId}/communication/?view=kona_league_communication`;
    const headers = {
      'x-fantasy-filter': JSON.stringify({
        topics: {
          filterType: { value: ['ACTIVITY_TRANSACTIONS'] },
          limit: pageSize,
          limitPerMessageSet: { value: pageSize },
          offset,
          sortMessageDate: { sortPriority: 1, sortAsc: false },
          sortFor: { sortPriority: 2, sortAsc: false },
          filterIncludeMessageTypeIds: { value: ACTIVITY_MESSAGE_IDS },
        }
      }),
    };

    let res: Response;
    try {
      res = await espnFetch(path, gameId, {
        credentials,
        timeout: Math.max(1, Math.min(7000, remaining)),
        headers,
      });
    } catch (error) {
      if (
        Date.now() >= deadline
        || (error instanceof Error && error.message.startsWith(`${ErrorCode.ESPN_TIMEOUT}:`))
      ) {
        break;
      }
      throw error;
    }
    if (!res.ok) handleEspnError(res);

    const body = await res.json() as EspnActivityResponse;
    const topics = body.topics ?? [];
    if (topics.length === 0) {
      exhausted = true;
      break;
    }

    for (let topicIndex = 0; topicIndex < topics.length; topicIndex += 1) {
      const topic = topics[topicIndex];
      const membershipTimeout = Math.max(1, Math.min(7000, deadline - Date.now()));
      const tradeResult = await normalizeTradeTopic(
        gameId,
        seasonYear,
        sport,
        topic,
        window,
        membershipTimeout,
      );
      if (tradeResult.omission === 'unscoped') omittedUnscopedRows += 1;
      if (tradeResult.omission === 'conflict') omittedConflictingRows += 1;
      if (tradeResult.coverageIncomplete) membershipCoverageIncomplete = true;
      const messages = topic.messages ?? [];
      const topicTimestamp = topic.date ?? 0;
      for (let msgIndex = 0; msgIndex < messages.length; msgIndex += 1) {
        const msg = messages[msgIndex];
        const normalizedType = toTxnTypeFromMessageId(msg.messageTypeId);
        if (!normalizedType) continue;
        if (normalizedType === 'trade') continue;

        const membership = await resolveActivityMembership(
          gameId,
          seasonYear,
          sport,
          window,
          topic,
          msg,
          Math.max(1, Math.min(7000, deadline - Date.now())),
        );
        if (membership.kind === 'outside') continue;
        if (membership.kind === 'timeout') {
          omittedUnscopedRows += 1;
          membershipCoverageIncomplete = true;
          continue;
        }
        if (membership.kind === 'unscoped') {
          omittedUnscopedRows += 1;
          continue;
        }
        if (membership.kind === 'conflict') {
          omittedConflictingRows += 1;
          continue;
        }

        const timestamp = msg.date ?? topicTimestamp;
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
          omittedUnscopedRows += 1;
          continue;
        }
        const id = String(msg.id ?? `${topic.id || `topic-${topicIndex}`}-${msg.messageTypeId || 'unknown'}-${msg.targetId || 'na'}-${timestamp}-${msgIndex}`);
        if (seen.has(id)) continue;
        seen.add(id);

        const added: Array<{ id: string }> = [];
        const dropped: Array<{ id: string }> = [];
        const targetId = msg.targetId !== undefined ? String(msg.targetId) : undefined;
        if (targetId && (normalizedType === 'add' || normalizedType === 'waiver')) {
          added.push({ id: targetId });
        }
        if (targetId && normalizedType === 'drop') {
          dropped.push({ id: targetId });
        }

        out.push({
          transaction_id: id,
          type: normalizedType,
          status: 'complete',
          timestamp,
          date: etDateOf(timestamp),
          week: membership.matchupPeriodId,
          provider_scoring_period_id: membership.scoringPeriodId,
          team_ids: getTeamIds(msg.messageTypeId || 0, msg),
          players_added: added,
          players_dropped: dropped,
          faab_bid: null,
        });
      }

      if (tradeResult.transaction && !seen.has(tradeResult.transaction.transaction_id)) {
        seen.add(tradeResult.transaction.transaction_id);
        out.push(tradeResult.transaction);
      }
    }

    const topicDates = topics
      .flatMap((topic) => [
        ...(typeof topic.date === 'number' ? [topic.date] : []),
        ...(topic.messages ?? []).flatMap((message) =>
          typeof message.date === 'number' ? [message.date] : []
        ),
      ])
      .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0)
      .map(etDateOf);
    if (
      window.startDate !== null
      && topicDates.length > 0
      && topicDates.sort()[0] < window.startDate
    ) {
      coverageProven = true;
      break;
    }
    if (topics.length < pageSize) {
      exhausted = true;
      break;
    }
  }

  return {
    transactions: out.sort((a, b) => b.timestamp - a.timestamp),
    omittedUnscopedRows,
    omittedConflictingRows,
    coverageIncomplete:
      membershipCoverageIncomplete || !(exhausted || coverageProven),
  };
}

/**
 * Legacy test/helper surface. Production handlers use the matchup-aware window
 * resolver and fetchEspnTransactionsByWindow.
 */
export async function fetchEspnTransactionsByWeeks(
  gameId: string,
  leagueId: string,
  seasonYear: number,
  credentials: EspnCredentials,
  weeks: number[],
): Promise<NormalizedTransaction[]> {
  const sportByGameId: Record<string, SeasonSport> = {
    flb: 'baseball',
    fba: 'basketball',
    fhl: 'hockey',
    ffl: 'football',
  };
  const result = await fetchEspnTransactionsByWindow(
    gameId,
    leagueId,
    seasonYear,
    sportByGameId[gameId] ?? 'football',
    credentials,
    coerceTransactionWindow(weeks),
    Date.now() + TRANSACTION_OPERATION_MS,
  );
  return result.transactions;
}

export async function fetchEspnPlayersByIds(
  gameId: string,
  seasonYear: number,
  playerIds: string[],
  timeout = 10000,
): Promise<Map<string, EspnPlayerBasic>> {
  const map = new Map<string, EspnPlayerBasic>();
  if (playerIds.length === 0) return map;

  const numericIds = playerIds.map(Number).filter(Number.isFinite);
  const path = `/seasons/${seasonYear}/players?scoringPeriodId=0&view=players_wl`;
  const filterHeader = JSON.stringify({ filterIds: { value: numericIds } });

  const res = await espnFetch(path, gameId, {
    timeout,
    headers: { 'x-fantasy-filter': filterHeader },
  });

  if (res.ok) {
    const players = await res.json() as Array<{ id?: number; fullName?: string; defaultPositionId?: number; proTeamId?: number }>;
    for (const p of players) {
      if (p.id !== undefined) {
        map.set(String(p.id), { fullName: p.fullName, defaultPositionId: p.defaultPositionId, proTeamId: p.proTeamId });
      }
    }
  }

  console.log(`[fetchEspnPlayersByIds] ${gameId} requested=${playerIds.length} resolved=${map.size}`);
  return map;
}

interface ExecuteEspnTransactionOperationInput {
  gameId: string;
  leagueId: string;
  seasonYear: number;
  sport: SeasonSport;
  credentials: EspnCredentials;
  requestedWeek?: number;
  type?: TransactionType;
  count?: number;
  getPositionName: (id: number) => string;
  getProTeamAbbrev: (id: number) => string;
}

export async function executeEspnTransactionOperation({
  gameId,
  leagueId,
  seasonYear,
  sport,
  credentials,
  requestedWeek,
  type,
  count,
  getPositionName,
  getProTeamAbbrev,
}: ExecuteEspnTransactionOperationInput): Promise<EspnTransactionOperationResult> {
  const startedAt = Date.now();
  const providerDeadline = startedAt + TRANSACTION_OPERATION_MS - ENRICHMENT_RESERVE_MS;
  const totalDeadline = startedAt + TRANSACTION_OPERATION_MS;
  const context = await getEspnLeagueContext(
    gameId,
    leagueId,
    seasonYear,
    credentials,
    Math.max(1, Math.min(7000, providerDeadline - Date.now())),
  );
  const window = await resolveEspnTransactionWindow({
    gameId,
    seasonYear,
    sport,
    context,
    requestedWeek,
    timeout: Math.max(1, Math.min(7000, providerDeadline - Date.now())),
  });

  // Primary path: ESPN's structured mTransactions2 view (repaired transport,
  // FLA-140). Any failure — transport, malformed body, budget — falls back to
  // the activity feed so the operation stays contract-correct if the
  // undocumented primary regresses again. The structured attempt gets at most
  // half the remaining provider budget: a hanging primary must degrade to a
  // fallback with usable time, not starve it into an empty response.
  const structuredDeadline = Math.min(
    providerDeadline,
    Date.now() + Math.max(1, Math.floor((providerDeadline - Date.now()) / 2)),
  );
  let structured: MTransactions2Result | null = null;
  try {
    structured = await fetchEspnMTransactions2(
      gameId,
      leagueId,
      seasonYear,
      credentials,
      window,
      structuredDeadline,
    );
  } catch (error) {
    console.warn(
      '[get_transactions] structured source unavailable, using activity feed:',
      error instanceof Error ? error.message : error,
    );
  }

  const tradesMissingSides = (transactions: NormalizedTransaction[]): number =>
    transactions.filter(
      (txn) =>
        TRADE_TYPES.includes(txn.type)
        && !(txn.trade_sides ?? []).some(
          (side) => side.acquired.length > 0 || side.gave_up.length > 0,
        ),
    ).length;

  let source: EspnTransactionOperationResult['source'];
  let sourceTransactions: NormalizedTransaction[];
  let activity: ActivityTransactionsResult | null = null;
  let structuredDetailsIncomplete = false;

  if (structured) {
    source = 'mTransactions2';
    sourceTransactions = structured.transactions;

    const missingBefore = tradesMissingSides(sourceTransactions);
    if (missingBefore > 0 && providerDeadline - Date.now() > 0) {
      // Structured trade rows without movement items get their directional
      // sides from the activity feed. A supplement failure only degrades
      // trade detail, never the primary rows.
      try {
        const supplement = await fetchEspnTransactionsByWindow(
          gameId,
          leagueId,
          seasonYear,
          sport,
          credentials,
          window,
          providerDeadline,
        );
        sourceTransactions = mergeTradePlayerDetails(
          sourceTransactions,
          supplement.transactions,
        );
        if (tradesMissingSides(sourceTransactions) < missingBefore) {
          source = 'mTransactions2_with_activity_trade_details';
        }
      } catch (error) {
        console.warn(
          '[get_transactions] activity trade-detail supplement failed:',
          error instanceof Error ? error.message : error,
        );
      }
      structuredDetailsIncomplete = tradesMissingSides(sourceTransactions) > 0;
    } else {
      structuredDetailsIncomplete = missingBefore > 0;
    }
  } else {
    if (type && STRUCTURED_ONLY_TYPES.has(type)) {
      throw new Error(
        `${ErrorCode.ESPN_TRANSACTION_TYPE_UNAVAILABLE}: ESPN ${type} requires the structured transaction source, which is temporarily unavailable. Retry without this type filter for completed activity-feed transactions.`
      );
    }
    source = 'activity_feed';
    activity = await fetchEspnTransactionsByWindow(
      gameId,
      leagueId,
      seasonYear,
      sport,
      credentials,
      window,
      providerDeadline,
    );
    sourceTransactions = activity.transactions;
    structuredDetailsIncomplete = true;
  }

  const maxCount = count ?? 25;
  const matchingTransactions = sourceTransactions
    .filter((transaction) => !type || transaction.type === type);
  let transactions = matchingTransactions.slice(0, maxCount);
  const countTruncated = matchingTransactions.length > maxCount;
  const allIds = [...new Set(transactions.flatMap(collectTransactionPlayerIds))];
  const enrichmentRemaining = totalDeadline - Date.now();
  if (allIds.length > 0 && enrichmentRemaining > 0) {
    try {
      const playerMap = await fetchEspnPlayersByIds(
        gameId,
        seasonYear,
        allIds,
        Math.max(1, Math.min(ENRICHMENT_RESERVE_MS, enrichmentRemaining)),
      );
      transactions = enrichTransactions(
        transactions,
        playerMap,
        getPositionName,
        getProTeamAbbrev,
      );
    } catch (error) {
      console.warn(
        '[get_transactions] Player enrichment failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  const limitations: EspnTransactionLimitations = {};
  if (structuredDetailsIncomplete) {
    limitations.structured_details_incomplete = true;
  }
  if (activity) {
    // Row-sourcing limitations apply only when the activity feed IS the row
    // source, not when it merely supplemented trade detail.
    if (activity.omittedUnscopedRows > 0) {
      limitations.omitted_unscoped_rows = activity.omittedUnscopedRows;
    }
    if (activity.omittedConflictingRows > 0) {
      limitations.omitted_conflicting_rows = activity.omittedConflictingRows;
    }
    if (activity.coverageIncomplete) {
      limitations.window_coverage_incomplete = true;
    }
  }
  if (DAILY_SPORTS.has(sport) && window.dateBoundsKind === 'unavailable') {
    limitations.exact_date_bounds_unavailable = true;
  }
  if (countTruncated) {
    limitations.possibly_truncated = true;
  }

  return {
    window: {
      mode: window.mode,
      unit: 'matchup_period',
      requested_week: window.requestedWeek,
      normalization: window.normalization,
      weeks: window.matchupPeriodIds,
      provider_scoring_period_ids: window.scoringPeriodIds,
      start_date: window.startDate,
      end_date: window.endDate,
      date_bounds_kind: window.dateBoundsKind,
      timezone: window.timezone,
      returned_rows: transactions.length,
    },
    source,
    limitations,
    transactions,
    teams: context.teams,
    truncated: (activity?.coverageIncomplete ?? false) || countTruncated,
  };
}

export function enrichTransactions(
  transactions: NormalizedTransaction[],
  playerMap: Map<string, EspnPlayerBasic>,
  getPositionName: (id: number) => string,
  getProTeamAbbrev: (id: number) => string,
): NormalizedTransaction[] {
  const enrich = (
    entries?: Array<{ id: string; name?: string; position?: string; team?: string }>,
  ) =>
    entries?.map((p) => {
      const info = playerMap.get(p.id);
      if (!info) return p;
      return {
        ...p,
        name: info.fullName,
        position: info.defaultPositionId !== undefined ? getPositionName(info.defaultPositionId) : undefined,
        team: info.proTeamId !== undefined ? getProTeamAbbrev(info.proTeamId) : undefined,
      };
    });

  return transactions.map((txn) => ({
    ...txn,
    players_added: enrich(txn.players_added),
    players_dropped: enrich(txn.players_dropped),
    trade_sides: txn.trade_sides?.map((side) => ({
      ...side,
      acquired: enrich(side.acquired) ?? [],
      gave_up: enrich(side.gave_up) ?? [],
    })),
  }));
}
