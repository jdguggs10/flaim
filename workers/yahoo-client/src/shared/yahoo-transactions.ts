import { asArray, getPath, unwrapLeague } from './normalizers';

export type TransactionType = 'add' | 'drop' | 'trade' | 'waiver';

export interface NormalizedTransaction {
  transaction_id: string;
  type: TransactionType;
  status: 'complete' | 'failed' | 'pending' | 'unknown';
  timestamp: number;
  date: string;
  week: number | null;
  team_ids?: string[];
  players_added?: Array<{ id: string; name?: string }>;
  players_dropped?: Array<{ id: string; name?: string }>;
  faab_bid?: number | null;
  draft_picks?: unknown[] | null;
}

export function buildYahooTransactionsPath(leagueKey: string, count = 25): string {
  const clamped = Math.max(1, Math.min(100, count));
  return `/league/${leagueKey}/transactions;types=add,drop,trade;count=${clamped}`;
}

function canonicalType(value: unknown): TransactionType | null {
  if (typeof value !== 'string') return null;
  if (value === 'add') return 'add';
  if (value === 'drop') return 'drop';
  if (value === 'trade') return 'trade';
  if (value === 'waiver') return 'waiver';
  return null;
}

function parseFaabBid(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapStatus(value: unknown): 'complete' | 'failed' | 'pending' | 'unknown' {
  if (value === 'successful' || value === 'complete') return 'complete';
  if (value === 'failed') return 'failed';
  if (value === 'pending') return 'pending';
  return 'unknown';
}

export function normalizeYahooTransactions(raw: unknown): NormalizedTransaction[] {
  const leagueArray = getPath(raw, ['fantasy_content', 'league']);
  const league = unwrapLeague(leagueArray);
  const txnsObj = getPath(league, ['transactions']) as Record<string, unknown> | undefined;
  const txnsArray = asArray(txnsObj);

  const out: NormalizedTransaction[] = [];

  for (const wrapper of txnsArray) {
    const txnNode = getPath(wrapper, ['transaction']) as unknown[] | undefined;
    if (!Array.isArray(txnNode)) continue;

    let meta: Record<string, unknown> = {};
    for (const item of txnNode) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        meta = { ...meta, ...(item as Record<string, unknown>) };
      }
    }

    const type = canonicalType(meta.type);
    if (!type) continue;

    const playersAdded: Array<{ id: string; name?: string }> = [];
    const playersDropped: Array<{ id: string; name?: string }> = [];
    let faabBid: number | null = null;

    const playersObj = meta.players as Record<string, unknown> | undefined;
    const playersArray = asArray(playersObj);
    for (const pw of playersArray) {
      const pdata = getPath(pw, ['player']) as unknown[] | undefined;
      if (!Array.isArray(pdata)) continue;

      let pmeta: Record<string, unknown> = {};
      let tdata: Record<string, unknown> = {};
      for (const e of pdata) {
        if (Array.isArray(e)) {
          for (const m of e) {
            if (typeof m === 'object' && m !== null) {
              pmeta = { ...pmeta, ...(m as Record<string, unknown>) };
            }
          }
        } else if (typeof e === 'object' && e !== null) {
          const td = (e as Record<string, unknown>).transaction_data as Record<string, unknown> | undefined;
          if (td) tdata = td;
        }
      }

      const pid = String(pmeta.player_id ?? pmeta.player_key ?? '');
      const name = ((pmeta.name as Record<string, unknown> | undefined)?.full as string | undefined);
      const t = String(tdata.type ?? '').toLowerCase();
      const candidateBid = parseFaabBid(tdata.faab_bid ?? tdata.waiver_bid);
      if (faabBid === null && candidateBid !== null) {
        faabBid = candidateBid;
      }
      if (pid) {
        if (t === 'add') playersAdded.push({ id: pid, name });
        if (t === 'drop') playersDropped.push({ id: pid, name });
      }
    }

    const teamIds = [meta.trader_team_key, meta.tradee_team_key]
      .filter((v) => typeof v === 'string')
      .map((v) => String(v));

    const timestamp = Number(meta.timestamp ?? 0) * 1000;
    if (faabBid === null) {
      faabBid = parseFaabBid(meta.faab_bid ?? meta.waiver_bid);
    }
    out.push({
      transaction_id: String(meta.transaction_key ?? meta.transaction_id ?? `${type}-${timestamp}`),
      type,
      status: mapStatus(meta.status),
      timestamp,
      date: new Date(timestamp).toISOString().slice(0, 10),
      week: null,
      team_ids: teamIds.length > 0 ? teamIds : undefined,
      players_added: playersAdded,
      players_dropped: playersDropped,
      faab_bid: faabBid,
      draft_picks: Array.isArray(meta.picks) ? meta.picks : null,
    });
  }

  return out.sort((a, b) => b.timestamp - a.timestamp);
}
