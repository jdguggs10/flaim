import type { Env, Sport, SleeperLeagueUser } from '../types';
import { getSleeperPlayersIndex, type SleeperPlayerRecord } from './sleeper-players-cache';

const SLEEPER_EMPTY_LINEUP_SLOT_ID = '0';

export const SLEEPER_PLAYER_ENRICHMENT_WARNING =
  'PLAYER_ENRICHMENT_UNAVAILABLE: Sleeper player index unavailable; roster/matchup player entries include id only.';

export interface SleeperUserDirectoryEntry {
  displayName: string;
  /**
   * Fantasy team name as Sleeper displays it: the manager-set
   * users[].metadata.team_name when present, otherwise Sleeper's own default
   * "Team <display name>" (which is what league members see in the app).
   */
  teamName: string;
}

export interface SleeperPlayerEntry {
  id: string;
  name?: string;
  position?: string;
  team?: string;
  /** True for Sleeper's "0" empty-lineup-slot sentinel; no name lookup is attempted for it. */
  empty?: true;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Maps Sleeper league users by user_id to their display name and fantasy team
 * name. Sleeper only exposes a manager-set team name via
 * users[].metadata.team_name; when it is unset, Sleeper's own app displays
 * "Team <display name>" (confirmed by users), so that is what teamName falls
 * back to — the value league members actually see, not an invention.
 */
export function sleeperDefaultTeamName(displayName: string): string {
  return `Team ${displayName}`;
}

export function buildUserDirectory(users: SleeperLeagueUser[]): Map<string, SleeperUserDirectoryEntry> {
  const directory = new Map<string, SleeperUserDirectoryEntry>();
  for (const user of users) {
    directory.set(user.user_id, {
      displayName: user.display_name,
      teamName: asNonEmptyString(user.metadata?.team_name) ?? sleeperDefaultTeamName(user.display_name),
    });
  }
  return directory;
}

export interface ResolveSleeperPlayerEntriesOptions {
  /**
   * Whether to include the player's real-life club. Defaults to true. The
   * player index only tracks each player's CURRENT club, so a historical
   * (past-week) roster must pass `{ includeTeam: false }` — otherwise a
   * player entry could show a club they joined after that week, breaking
   * temporal purity (FLA-192: historical rosters resolve identity only).
   */
  includeTeam?: boolean;
}

/**
 * Resolves bare Sleeper player-id strings into enriched entries using the
 * cached player index, preserving array order and length.
 * - "0" is Sleeper's empty-lineup-slot sentinel: returned as { id: "0", empty: true }, no lookup.
 * - Index hit: { id, name, position, team } (team omitted when the record has none, or when
 *   `includeTeam: false` is passed for a historical/past-week snapshot).
 * - Index miss (unknown id, or index unavailable/empty): { id } only — never throws.
 */
export function resolveSleeperPlayerEntries(
  ids: string[],
  index: Map<string, SleeperPlayerRecord>,
  options: ResolveSleeperPlayerEntriesOptions = {},
): SleeperPlayerEntry[] {
  const includeTeam = options.includeTeam ?? true;

  return ids.map((id) => {
    if (id === SLEEPER_EMPTY_LINEUP_SLOT_ID) {
      return { id, empty: true };
    }

    const player = index.get(id);
    if (!player) {
      return { id };
    }

    return {
      id,
      name: player.full_name,
      position: player.position,
      ...(includeTeam ? { team: player.team } : {}),
    };
  });
}

/**
 * Loads the shared Sleeper player index for roster/matchup enrichment. On
 * failure, degrades to an empty index (every entry resolves to { id } only)
 * plus a warning instead of failing the request — the same degradation
 * pattern used by get_transactions and get_free_agents.
 */
export async function loadSleeperPlayersIndexForEnrichment(
  env: Env,
  sport: Sport,
  logContext: string,
): Promise<{ index: Map<string, SleeperPlayerRecord>; warnings: string[] }> {
  try {
    const index = await getSleeperPlayersIndex(env, sport);
    if (index.size === 0) {
      // Belt-and-suspenders: getSleeperPlayersIndex now refuses to cache (or
      // return, on a fresh fetch) an empty index, but treat a genuinely
      // empty resolved index as degraded here too rather than silently
      // enriching nothing.
      console.error(`[${logContext}] Player index resolved empty; treating as unavailable for enrichment`);
      return { index, warnings: [SLEEPER_PLAYER_ENRICHMENT_WARNING] };
    }
    return { index, warnings: [] };
  } catch (error) {
    console.error(`[${logContext}] Failed to get player index for enrichment:`, error);
    return { index: new Map(), warnings: [SLEEPER_PLAYER_ENRICHMENT_WARNING] };
  }
}
