import { sleeperFetch, handleSleeperError } from './sleeper-api';
import type { SleeperLeagueUser, SleeperRoster } from '../types';
import { buildUserDirectory } from './sleeper-enrichment';

export type TransactionType = 'add' | 'drop' | 'trade' | 'waiver';

export interface NormalizedTransaction {
  transaction_id: string;
  type: TransactionType;
  status: 'complete' | 'failed' | 'pending' | 'unknown';
  timestamp: number;
  date: string;
  week: number | null;
  team_ids?: string[];
  /**
   * Owner/team names parallel to `team_ids` (same order, same length): each
   * entry resolves through the `teams` map, falling back to the raw roster
   * id when the map is unavailable or the id has no matching roster.
   */
  team_names?: string[];
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
  const stateWeek = state.week;
  return typeof stateWeek === 'number' && Number.isFinite(stateWeek) && stateWeek > 0 ? stateWeek : 1;
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

export interface SleeperRosterTeams {
  /**
   * roster id (string) -> teamName, exactly ESPN's transactions `teams`
   * shape (`Record<string, string>`) so both platforms share one schema.
   * Always a non-empty string: the manager-set fantasy team name, or
   * Sleeper's own "Team <display name>" default.
   */
  teams: Record<string, string>;
  /**
   * roster id (string) -> ownerName. Additive — ESPN's `teams` map has no
   * owner-name equivalent, so this is a separate top-level key rather than
   * a value shape ESPN's map doesn't use.
   */
  teamOwners: Record<string, string>;
}

/**
 * Fetches league rosters and users and resolves each roster id to its
 * owner and team name via the shared user directory (manager-set team name,
 * or Sleeper's own "Team <display name>" default). This is what lets
 * get_transactions label `team_ids` with names instead of making the caller
 * cross-reference get_league_info — mirroring ESPN's inline transactions
 * `teams` map (`teams`), plus an additive `teamOwners` map ESPN has no
 * equivalent for. A roster whose owner_id has no matching user (an orphaned
 * or bot-managed roster) is simply omitted from both maps rather than
 * guessed.
 *
 * Throws on a rosters/users fetch failure so the caller can degrade to
 * omitting both maps with a warning instead of failing the whole
 * get_transactions request.
 */
export async function fetchSleeperRosterTeams(leagueId: string): Promise<SleeperRosterTeams> {
  const [rostersRes, usersRes] = await Promise.all([
    sleeperFetch(`/league/${leagueId}/rosters`),
    sleeperFetch(`/league/${leagueId}/users`),
  ]);
  if (!rostersRes.ok) handleSleeperError(rostersRes);
  if (!usersRes.ok) handleSleeperError(usersRes);

  const rosters: SleeperRoster[] = await rostersRes.json();
  const users: SleeperLeagueUser[] = await usersRes.json();
  const userDirectory = buildUserDirectory(users);

  const teams: Record<string, string> = {};
  const teamOwners: Record<string, string> = {};
  for (const roster of rosters) {
    const entry = userDirectory.get(roster.owner_id);
    if (!entry) continue;
    const rosterId = String(roster.roster_id);
    teams[rosterId] = entry.teamName;
    teamOwners[rosterId] = entry.displayName;
  }
  return { teams, teamOwners };
}

/**
 * Adds `team_names` (parallel to `team_ids`) to each transaction row by
 * resolving each roster id through `teams`. A roster id absent from `teams`
 * — because the map itself is unavailable, or that particular id has no
 * matching roster — falls back to the raw id rather than being dropped or
 * guessed. Rows without `team_ids` pass through unchanged.
 */
export function attachTeamNames(
  transactions: NormalizedTransaction[],
  teams: Record<string, string> | undefined,
): NormalizedTransaction[] {
  return transactions.map((txn) => {
    if (!txn.team_ids) return txn;
    return { ...txn, team_names: txn.team_ids.map((id) => teams?.[id] ?? id) };
  });
}
