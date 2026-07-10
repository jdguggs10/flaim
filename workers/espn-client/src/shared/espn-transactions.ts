import type { EspnCredentials, SeasonSport } from '@flaim/worker-shared';
import { espnFetch, handleEspnError } from './espn-api';
import { getCurrentSeasonYear } from './season';

export type TransactionType = 'add' | 'drop' | 'trade' | 'waiver' | 'trade_proposal' | 'trade_decline' | 'trade_veto' | 'trade_uphold' | 'failed_bid';

export interface NormalizedTransaction {
  transaction_id: string;
  type: TransactionType;
  status: 'complete' | 'failed' | 'pending' | 'unknown';
  timestamp: number;
  date: string;
  week: number | null;
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
      `ESPN_SEASON_NOT_SUPPORTED: ESPN transactions are only available for the current season. Retry with season_year=${currentSeason}.`
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

export function normalizeMTransactions2(transactions: EspnMTransaction[]): NormalizedTransaction[] {
  const out: NormalizedTransaction[] = [];

  for (const txn of transactions) {
    const rawType = toTxnTypeFromMTransaction(txn.type);
    if (!rawType) continue;

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
    const teamIds = txn.teamId ? [String(txn.teamId)] : [];

    // ESPN marks standalone free-agent drops as FREEAGENT with only drop items.
    const type: TransactionType = rawType === 'add' && added.length === 0 && dropped.length > 0
      ? 'drop'
      : rawType;

    out.push({
      transaction_id: String(txn.id ?? `mtx-${timestamp}`),
      type,
      status: toStatus(type, txn.status),
      timestamp,
      date: new Date(timestamp).toISOString().slice(0, 10),
      week: txn.scoringPeriodId ?? null,
      team_ids: teamIds.length > 0 ? teamIds : undefined,
      players_added: added,
      players_dropped: dropped,
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

const MTRANSACTIONS2_PAGE_SIZE = 50;
const MTRANSACTIONS2_MAX_PAGES = 4;

export interface MTransactions2Result {
  transactions: NormalizedTransaction[];
  truncated: boolean;
}

export async function fetchEspnMTransactions2(
  gameId: string,
  leagueId: string,
  seasonYear: number,
  credentials: EspnCredentials,
  weeks: number[],
): Promise<MTransactions2Result> {
  const seen = new Set<string>();
  const all: NormalizedTransaction[] = [];
  let truncated = false;

  for (const week of weeks) {
    let hitMaxPageWithFullResults = false;
    for (let page = 0; page < MTRANSACTIONS2_MAX_PAGES; page++) {
      const offset = page * MTRANSACTIONS2_PAGE_SIZE;
      const path = `/seasons/${seasonYear}/segments/0/leagues/${leagueId}?view=mTransactions2&scoringPeriodId=${week}`;
      const headers = {
        'x-fantasy-filter': JSON.stringify({
          transactions: {
            filterType: { value: MTRANSACTIONS2_TYPES },
            limit: MTRANSACTIONS2_PAGE_SIZE,
            offset,
            sortDatePublished: { sortPriority: 1, sortAsc: false },
          },
        }),
      };

      const res = await espnFetch(path, gameId, { credentials, timeout: 7000, headers });
      if (!res.ok) handleEspnError(res);

      const body = await res.json() as EspnMTransactions2Response;
      const rawTxns = body.transactions ?? [];
      const normalized = normalizeMTransactions2(rawTxns);

      for (const txn of normalized) {
        if (!seen.has(txn.transaction_id)) {
          seen.add(txn.transaction_id);
          all.push(txn);
        }
      }

      if (rawTxns.length < MTRANSACTIONS2_PAGE_SIZE) break;

      // Hit max pages for this week with a full page; probe one extra row later.
      if (page === MTRANSACTIONS2_MAX_PAGES - 1) {
        hitMaxPageWithFullResults = true;
      }
    }

    if (hitMaxPageWithFullResults) {
      const probeOffset = MTRANSACTIONS2_MAX_PAGES * MTRANSACTIONS2_PAGE_SIZE;
      const probePath = `/seasons/${seasonYear}/segments/0/leagues/${leagueId}?view=mTransactions2&scoringPeriodId=${week}`;
      const probeHeaders = {
        'x-fantasy-filter': JSON.stringify({
          transactions: {
            filterType: { value: MTRANSACTIONS2_TYPES },
            limit: 1,
            offset: probeOffset,
            sortDatePublished: { sortPriority: 1, sortAsc: false },
          },
        }),
      };

      const probeRes = await espnFetch(probePath, gameId, { credentials, timeout: 7000, headers: probeHeaders });
      if (!probeRes.ok) handleEspnError(probeRes);
      const probeBody = await probeRes.json() as EspnMTransactions2Response;
      if ((probeBody.transactions?.length ?? 0) > 0) {
        truncated = true;
        console.warn(`[fetchEspnMTransactions2] Hit page limit for week ${week}, results may be incomplete`);
      }
    }
  }

  return { transactions: all.sort((a, b) => b.timestamp - a.timestamp), truncated };
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

    const hasPlayers = collectTransactionPlayerIds(txn).length > 0;
    if (hasPlayers) return txn;

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
      players_added: match.players_added,
      players_dropped: match.players_dropped,
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

function getWeekFromActivity(topic: EspnActivityTopic, message: EspnActivityMessage): number | null {
  const candidates = [
    message.scoringPeriodId,
    message.matchupPeriodId,
    topic.scoringPeriodId,
    topic.matchupPeriodId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return null;
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

function normalizeTradeTopic(
  topic: EspnActivityTopic,
  requestedWeeks: Set<number>,
  explicitSingleWeek: boolean,
): NormalizedTransaction | null {
  const messages = topic.messages ?? [];
  const tradeMessages = messages.filter(
    (msg) =>
      msg.messageTypeId === 244 &&
      msg.targetId !== undefined &&
      typeof msg.from === 'number' &&
      msg.from > 0 &&
      typeof msg.to === 'number' &&
      msg.to > 0,
  );
  if (tradeMessages.length === 0) return null;

  const week = getWeekFromActivity(topic, tradeMessages[0]);
  if (week !== null && requestedWeeks.size > 0 && !requestedWeeks.has(week)) {
    return null;
  }
  if (week === null && explicitSingleWeek) {
    return null;
  }

  const timestamp = tradeMessages[0].date ?? topic.date ?? 0;
  const movements = tradeMessages.map((msg) => ({
    playerId: String(msg.targetId),
    fromTeamId: String(msg.from),
    toTeamId: String(msg.to),
  }));
  const tradeSides = buildTradeSides(movements);
  const teamIds = tradeSides.map((side) => side.team_id);

  return {
    transaction_id: String(topic.id ?? `trade-${timestamp}-${teamIds.join('-')}`),
    type: 'trade',
    status: 'complete',
    timestamp,
    date: new Date(timestamp).toISOString().slice(0, 10),
    week,
    team_ids: teamIds,
    players_added: [],
    players_dropped: [],
    trade_sides: tradeSides,
    faab_bid: null,
  };
}

export interface EspnLeagueContext {
  scoringPeriodId: number;
  teams: Record<string, string>;
}

export async function getEspnLeagueContext(
  gameId: string,
  leagueId: string,
  seasonYear: number,
  credentials: EspnCredentials,
): Promise<EspnLeagueContext> {
  const path = `/seasons/${seasonYear}/segments/0/leagues/${leagueId}?view=mSettings&view=mTeam`;
  const res = await espnFetch(path, gameId, { credentials, timeout: 7000 });
  if (!res.ok) handleEspnError(res);
  const data = await res.json() as {
    scoringPeriodId?: number;
    teams?: Array<{ id: number; location?: string; nickname?: string; name?: string }>;
  };
  const teams: Record<string, string> = {};
  for (const t of data.teams ?? []) {
    teams[String(t.id)] = t.location && t.nickname
      ? `${t.location} ${t.nickname}`
      : t.name || `Team ${t.id}`;
  }
  return {
    scoringPeriodId: data.scoringPeriodId ?? 1,
    teams,
  };
}

export async function fetchEspnTransactionsByWeeks(
  gameId: string,
  leagueId: string,
  seasonYear: number,
  credentials: EspnCredentials,
  weeks: number[],
): Promise<NormalizedTransaction[]> {
  const requestedWeeks = new Set(weeks);
  const explicitSingleWeek = weeks.length === 1;
  const pageSize = 25;
  const maxPages = 8;
  const seen = new Set<string>();
  const out: NormalizedTransaction[] = [];

  for (let page = 0; page < maxPages; page += 1) {
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

    const res = await espnFetch(path, gameId, { credentials, timeout: 7000, headers });
    if (!res.ok) handleEspnError(res);

    const body = await res.json() as EspnActivityResponse;
    const topics = body.topics ?? [];
    if (topics.length === 0) break;

    for (let topicIndex = 0; topicIndex < topics.length; topicIndex += 1) {
      const topic = topics[topicIndex];
      const tradeRow = normalizeTradeTopic(topic, requestedWeeks, explicitSingleWeek);
      const messages = topic.messages ?? [];
      const topicTimestamp = topic.date ?? 0;
      for (let msgIndex = 0; msgIndex < messages.length; msgIndex += 1) {
        const msg = messages[msgIndex];
        const normalizedType = toTxnTypeFromMessageId(msg.messageTypeId);
        if (!normalizedType) continue;
        if (normalizedType === 'trade') continue;

        const inferredWeek = getWeekFromActivity(topic, msg);
        if (inferredWeek !== null && requestedWeeks.size > 0 && !requestedWeeks.has(inferredWeek)) {
          continue;
        }
        if (inferredWeek === null && explicitSingleWeek) {
          // Avoid returning mis-scoped data when caller asked for one explicit week.
          continue;
        }

        const timestamp = msg.date ?? topicTimestamp;
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
          date: new Date(timestamp).toISOString().slice(0, 10),
          week: inferredWeek,
          team_ids: getTeamIds(msg.messageTypeId || 0, msg),
          players_added: added,
          players_dropped: dropped,
          faab_bid: msg.messageTypeId === 180 && typeof msg.from === 'number' ? msg.from : null,
        });
      }

      if (tradeRow && !seen.has(tradeRow.transaction_id)) {
        seen.add(tradeRow.transaction_id);
        out.push(tradeRow);
      }
    }

    if (topics.length < pageSize) break;
  }

  return out.sort((a, b) => b.timestamp - a.timestamp);
}

export async function fetchEspnPlayersByIds(
  gameId: string,
  seasonYear: number,
  playerIds: string[],
): Promise<Map<string, EspnPlayerBasic>> {
  const map = new Map<string, EspnPlayerBasic>();
  if (playerIds.length === 0) return map;

  const numericIds = playerIds.map(Number).filter(Number.isFinite);
  const path = `/seasons/${seasonYear}/players?scoringPeriodId=0&view=players_wl`;
  const filterHeader = JSON.stringify({ filterIds: { value: numericIds } });

  const res = await espnFetch(path, gameId, {
    timeout: 10000,
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
