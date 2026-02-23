import { sleeperFetch, handleSleeperError } from './sleeper-api';

export type TransactionType = 'add' | 'drop' | 'trade' | 'waiver';

export interface NormalizedTransaction {
  transaction_id: string;
  type: TransactionType;
  status: 'complete' | 'failed' | 'pending' | 'unknown';
  timestamp: number;
  week: number | null;
  team_ids?: string[];
  players_added?: Array<{ id: string }>;
  players_dropped?: Array<{ id: string }>;
  faab_bid?: number | null;
  draft_picks?: unknown[] | null;
}

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

function normalizeOne(txn: SleeperTransaction): NormalizedTransaction | null {
  const type = mapType(txn.type);
  if (!type) return null;

  const added = Object.keys(txn.adds ?? {}).map((id) => ({ id }));
  const dropped = Object.keys(txn.drops ?? {}).map((id) => ({ id }));

  return {
    transaction_id: String(txn.transaction_id ?? `${txn.type || 'unknown'}-${txn.status_updated || txn.created || 0}`),
    type,
    status: mapStatus(txn.status),
    timestamp: Number(txn.status_updated ?? txn.created ?? 0),
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
): Promise<NormalizedTransaction[]> {
  const seen = new Set<string>();
  const out: NormalizedTransaction[] = [];

  for (const week of weeks) {
    const res = await sleeperFetch(`/league/${leagueId}/transactions/${week}`);
    if (!res.ok) handleSleeperError(res);
    const txns = await res.json() as SleeperTransaction[];

    for (const txn of txns ?? []) {
      const normalized = normalizeOne(txn);
      if (!normalized) continue;
      if (seen.has(normalized.transaction_id)) continue;
      seen.add(normalized.transaction_id);
      out.push(normalized);
    }
  }

  return out.sort((a, b) => b.timestamp - a.timestamp);
}
