import type { EspnCredentials } from '@flaim/worker-shared';
import { espnFetch, handleEspnError } from './espn-api';

export type TransactionType = 'add' | 'drop' | 'trade' | 'waiver';

export interface NormalizedTransaction {
  transaction_id: string;
  type: TransactionType;
  status: 'complete' | 'failed' | 'pending' | 'unknown';
  timestamp: number;
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

export async function getCurrentEspnScoringPeriod(
  gameId: string,
  leagueId: string,
  seasonYear: number,
  credentials: EspnCredentials,
): Promise<number> {
  const path = `/seasons/${seasonYear}/segments/0/leagues/${leagueId}?view=mSettings`;
  const res = await espnFetch(path, gameId, { credentials, timeout: 7000 });
  if (!res.ok) handleEspnError(res);
  const data = await res.json() as { scoringPeriodId?: number };
  return data.scoringPeriodId ?? 1;
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
  leagueId: string,
  seasonYear: number,
  credentials: EspnCredentials,
  playerIds: string[],
): Promise<Map<string, EspnPlayerBasic>> {
  // kona_playercard supports filterIds and returns PlayerPoolEntry objects (same structure as mRoster)
  const path = `/seasons/${seasonYear}/segments/0/leagues/${leagueId}?view=kona_playercard`;
  const filter = {
    players: {
      filterIds: { value: playerIds.map(Number) },
      limit: playerIds.length,
    },
  };

  const res = await espnFetch(path, gameId, {
    credentials,
    timeout: 7000,
    headers: { 'X-Fantasy-Filter': JSON.stringify(filter) },
  });
  if (!res.ok) handleEspnError(res);

  type PlayerShape = { id?: number; fullName?: string; defaultPositionId?: number; proTeamId?: number };
  const body = await res.json() as { players?: Array<{ player?: PlayerShape; playerPoolEntry?: { player?: PlayerShape } }> };
  const playerCount = body.players?.length ?? 0;
  console.log(`[fetchEspnPlayersByIds] ${gameId} league=${leagueId} requested=${playerIds.length} resolved=${playerCount}`);
  const map = new Map<string, EspnPlayerBasic>();
  for (const entry of body.players ?? []) {
    // kona_playercard nests player under playerPoolEntry; fall back to entry.player for safety
    const p = entry.playerPoolEntry?.player ?? entry.player;
    if (!p?.id) continue;
    map.set(String(p.id), {
      fullName: p.fullName,
      defaultPositionId: p.defaultPositionId,
      proTeamId: p.proTeamId,
    });
  }
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
