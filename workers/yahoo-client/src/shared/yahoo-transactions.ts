import { asArray, getPath, unwrapLeague } from './normalizers';

export type TransactionType = 'add' | 'drop' | 'trade' | 'waiver' | 'pending_trade';

export interface NormalizedTransaction {
  transaction_id: string;
  type: TransactionType;
  status: 'complete' | 'failed' | 'pending' | 'unknown';
  timestamp: number;
  date: string;
  week: number | null;
  team_ids?: string[];
  players_added?: TransactionPlayer[];
  players_dropped?: TransactionPlayer[];
  faab_bid?: number | null;
  waiver_priority?: number | null;
  draft_picks?: unknown[] | null;
}

type TransactionPlayer = {
  id: string;
  name?: string;
  position?: string;
  team?: string;
};

const COMPLETED_TRANSACTION_TYPES = ['add', 'drop', 'add/drop', 'trade'];

export function buildYahooTransactionsPath(leagueKey: string, count = 25): string {
  const clamped = Math.max(1, Math.min(100, count));
  const types = COMPLETED_TRANSACTION_TYPES.map((type) => encodeURIComponent(type)).join(',');
  return `/league/${leagueKey}/transactions;types=${types};count=${clamped}`;
}

export function buildYahooPendingTransactionsPath(
  leagueKey: string,
  teamKey: string,
  types: string[],
  count = 25,
): string {
  const clamped = Math.max(1, Math.min(100, count));
  return `/league/${leagueKey}/transactions;types=${types.join(',')};team_key=${teamKey};count=${clamped}`;
}

function canonicalType(value: unknown): TransactionType | null {
  if (typeof value !== 'string') return null;
  if (value === 'add') return 'add';
  if (value === 'drop') return 'drop';
  if (value === 'add/drop') return 'add';
  if (value === 'trade') return 'trade';
  if (value === 'waiver') return 'waiver';
  if (value === 'pending_trade') return 'pending_trade';
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

function mergeYahooRecordList(value: unknown): Record<string, unknown> {
  let merged: Record<string, unknown> = {};

  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (typeof item === 'object' && item !== null) {
      merged = { ...merged, ...(item as Record<string, unknown>) };
    }
  };

  visit(value);
  return merged;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function buildTransactionPlayer(pmeta: Record<string, unknown>): TransactionPlayer | null {
  const id = optionalId(pmeta.player_id) ?? optionalId(pmeta.player_key);
  if (!id) return null;

  const name = (pmeta.name as Record<string, unknown> | undefined)?.full;
  const player: TransactionPlayer = { id };
  const fullName = optionalString(name);
  const position = optionalString(pmeta.display_position);
  const team = optionalString(pmeta.editorial_team_abbr);

  if (fullName) player.name = fullName;
  if (position) player.position = position;
  if (team) player.team = team;

  return player;
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

    const rawType = canonicalType(meta.type);
    if (!rawType) continue;

    const playersAdded: TransactionPlayer[] = [];
    const playersDropped: TransactionPlayer[] = [];
    const teamIds = new Set(
      [meta.trader_team_key, meta.tradee_team_key]
        .filter((v) => typeof v === 'string')
        .map((v) => String(v)),
    );
    let faabBid: number | null = null;

    const playersObj = meta.players as Record<string, unknown> | undefined;
    const playersArray = asArray(playersObj);
    for (const pw of playersArray) {
      const pdata = getPath(pw, ['player']) as unknown[] | undefined;
      if (!Array.isArray(pdata)) continue;

      let tdata: Record<string, unknown> = {};
      let pmeta: Record<string, unknown> = {};
      for (const e of pdata) {
        if (Array.isArray(e)) {
          pmeta = { ...pmeta, ...mergeYahooRecordList(e) };
        } else if (typeof e === 'object' && e !== null) {
          const td = (e as Record<string, unknown>).transaction_data;
          if (td) tdata = mergeYahooRecordList(td);
        }
      }

      const t = String(tdata.type ?? '').toLowerCase();
      const candidateBid = parseFaabBid(tdata.faab_bid ?? tdata.waiver_bid);
      if (faabBid === null && candidateBid !== null) {
        faabBid = candidateBid;
      }
      const sourceTeamKey = optionalId(tdata.source_team_key);
      const destinationTeamKey = optionalId(tdata.destination_team_key);
      if (sourceTeamKey) teamIds.add(sourceTeamKey);
      if (destinationTeamKey) teamIds.add(destinationTeamKey);

      const player = buildTransactionPlayer(pmeta);
      if (player) {
        if (t === 'add') playersAdded.push(player);
        if (t === 'drop') playersDropped.push(player);
      }
    }

    const timestamp = Number(meta.timestamp ?? 0) * 1000;
    if (faabBid === null) {
      faabBid = parseFaabBid(meta.faab_bid ?? meta.waiver_bid);
    }
    const rawPriority = meta.waiver_priority;
    const waiverPriority =
      typeof rawPriority === 'number' && Number.isFinite(rawPriority) ? rawPriority
      : typeof rawPriority === 'string' && Number.isFinite(Number(rawPriority)) ? Number(rawPriority)
      : null;
    const type: TransactionType = rawType === 'add' && playersAdded.length === 0 && playersDropped.length > 0
      ? 'drop'
      : rawType;

    out.push({
      transaction_id: String(meta.transaction_key ?? meta.transaction_id ?? `${type}-${timestamp}`),
      type,
      status: mapStatus(meta.status),
      timestamp,
      date: new Date(timestamp).toISOString().slice(0, 10),
      week: null,
      team_ids: teamIds.size > 0 ? Array.from(teamIds) : undefined,
      players_added: playersAdded,
      players_dropped: playersDropped,
      faab_bid: faabBid,
      waiver_priority: waiverPriority,
      draft_picks: Array.isArray(meta.picks) ? meta.picks : null,
    });
  }

  return out.sort((a, b) => b.timestamp - a.timestamp);
}
