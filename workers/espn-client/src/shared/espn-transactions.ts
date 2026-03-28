import type { EspnCredentials } from '@flaim/worker-shared';
import { espnFetch, handleEspnError } from './espn-api';

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
  faab_bid?: number | null;
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
  const activityTrades = activityTxns.filter((t) => t.type === 'trade');
  const used = new Set<number>();

  return mTxns.map((txn) => {
    if (!TRADE_TYPES.includes(txn.type)) return txn;

    const hasPlayers = (txn.players_added?.length ?? 0) + (txn.players_dropped?.length ?? 0) > 0;
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
      const messages = topic.messages ?? [];
      const topicTimestamp = topic.date ?? 0;
      for (let msgIndex = 0; msgIndex < messages.length; msgIndex += 1) {
        const msg = messages[msgIndex];
        const normalizedType = toTxnTypeFromMessageId(msg.messageTypeId);
        if (!normalizedType) continue;

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
  }));
}
