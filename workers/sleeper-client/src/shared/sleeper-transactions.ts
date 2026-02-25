import { sleeperFetch, handleSleeperError } from './sleeper-api';

export type TransactionType = 'add' | 'drop' | 'trade' | 'waiver';

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
  draft_picks?: unknown[] | null;
}

export type PlayerResolver = (
  playerId: string
) => { name?: string; position?: string; team?: string } | undefined;

interface SleeperTransaction {
  transaction_id?: string;
  type?: string;
  status?: string;
  status_updated?: number;
  created?: number;
  leg?: number;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  settings?: { waiver_bid?: number } | null;
  draft_picks?: unknown[] | null;
}

function mapType(value?: string): TransactionType | null {
  if (!value) return null;
  if (value === 'trade') return 'trade';
  if (value === 'waiver') return 'waiver';
  if (value === 'free_agent') return 'add';
  return null;
}

function mapStatus(value?: string): 'complete' | 'failed' | 'pending' | 'unknown' {
  if (!value) return 'unknown';
  if (value === 'complete' || value === 'completed') return 'complete';
  if (value === 'failed') return 'failed';
  if (value === 'pending') return 'pending';
  return 'unknown';
}

function mapPlayers(
  playerIds: string[],
  resolvePlayer?: PlayerResolver,
): Array<{ id: string; name?: string; position?: string; team?: string }> {
  return playerIds.map((id) => {
    const resolved = resolvePlayer?.(id);
    return {
      id,
      name: resolved?.name,
      position: resolved?.position,
      team: resolved?.team,
    };
  });
}

function normalizeOne(txn: SleeperTransaction, resolvePlayer?: PlayerResolver): NormalizedTransaction | null {
  const type = mapType(txn.type);
  if (!type) return null;

  const added = mapPlayers(Object.keys(txn.adds ?? {}), resolvePlayer);
  const dropped = mapPlayers(Object.keys(txn.drops ?? {}), resolvePlayer);

  return {
    transaction_id: String(txn.transaction_id ?? `${txn.type || 'unknown'}-${txn.status_updated || txn.created || 0}`),
    type,
    status: mapStatus(txn.status),
    timestamp: Number(txn.status_updated ?? txn.created ?? 0),
    date: new Date(Number(txn.status_updated ?? txn.created ?? 0)).toISOString().slice(0, 10),
    week: txn.leg ?? null,
    team_ids: (txn.roster_ids ?? []).map((id) => String(id)),
    players_added: added,
    players_dropped: dropped,
    faab_bid: txn.settings?.waiver_bid ?? null,
    draft_picks: txn.draft_picks ?? null,
  };
}

export async function getSleeperCurrentWeek(statePath: '/state/nfl' | '/state/nba'): Promise<number> {
  const res = await sleeperFetch(statePath);
  if (!res.ok) handleSleeperError(res);
  const state = await res.json() as { week?: number };
  return state.week ?? 1;
}

export async function fetchSleeperTransactionsByWeeks(
  leagueId: string,
  weeks: number[],
  resolvePlayer?: PlayerResolver,
): Promise<NormalizedTransaction[]> {
  const seen = new Set<string>();
  const out: NormalizedTransaction[] = [];

  for (const week of weeks) {
    const res = await sleeperFetch(`/league/${leagueId}/transactions/${week}`);
    if (!res.ok) handleSleeperError(res);
    const txns = await res.json() as SleeperTransaction[];

    for (const txn of txns ?? []) {
      const normalized = normalizeOne(txn, resolvePlayer);
      if (!normalized) continue;
      if (seen.has(normalized.transaction_id)) continue;
      seen.add(normalized.transaction_id);
      out.push(normalized);
    }
  }

  return out.sort((a, b) => b.timestamp - a.timestamp);
}
