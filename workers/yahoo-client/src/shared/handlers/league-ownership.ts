import type { YahooCredentials } from '../auth';
import { yahooFetch } from '../yahoo-api';
import { asArray, getPath, unwrapLeague, unwrapTeam } from '../normalizers';
import { extractManagerName, extractPlayerMeta } from './utils';

export interface YahooLeagueOwnerInfo {
  teamKey: string;
  teamName: string;
  ownerName: string | undefined;
}

/**
 * `complete` distinguishes a genuinely free-agent miss from a miss caused by a
 * roster fetch we failed to complete. When false, callers must treat map misses
 * as "unknown" rather than FREE_AGENT.
 */
export interface YahooLeagueOwnershipResult {
  map: Map<string, YahooLeagueOwnerInfo>;
  complete: boolean;
}

const OWNERSHIP_TIMEOUT_MS = 12000;

function extractRosterPlayerIds(team: Record<string, unknown>): string[] {
  const rosterData = team.roster as Record<string, unknown> | undefined;
  const playersObj = getPath(rosterData, ['0', 'players']) as Record<string, unknown> | undefined;
  const playersArray = asArray(playersObj);

  return playersArray
    .map((playerWrapper: unknown) => {
      const playerData = getPath(playerWrapper, ['player']) as unknown[] | undefined;
      if (!Array.isArray(playerData)) return null;

      const playerMeta = extractPlayerMeta(playerData);
      const playerId = playerMeta.player_id;
      if (typeof playerId === 'string' || typeof playerId === 'number') {
        return String(playerId);
      }

      return null;
    })
    .filter((playerId): playerId is string => Boolean(playerId));
}

export async function fetchLeagueOwnershipMap(
  credentials: YahooCredentials,
  leagueId: string,
): Promise<YahooLeagueOwnershipResult | null> {
  try {
    const teamsResponse = await yahooFetch(`/league/${leagueId}/teams`, {
      credentials,
      timeout: OWNERSHIP_TIMEOUT_MS,
    });
    if (!teamsResponse.ok) {
      return null;
    }

    const teamsRaw = await teamsResponse.json();
    const leagueArray = getPath(teamsRaw, ['fantasy_content', 'league']);
    const league = unwrapLeague(leagueArray);
    const teamsObj = getPath(league, ['teams']) as Record<string, unknown> | undefined;
    const teamsArray = asArray(teamsObj);

    const rosterResults = await Promise.allSettled(
      teamsArray.map(async (teamWrapper: unknown) => {
        const teamData = getPath(teamWrapper, ['team']) as unknown[] | undefined;
        if (!Array.isArray(teamData)) return null;

        const team = unwrapTeam(teamData);
        const teamKey = typeof team.team_key === 'string' ? team.team_key : null;
        if (!teamKey) return null;

        try {
          const rosterResponse = await yahooFetch(`/team/${teamKey}/roster`, {
            credentials,
            timeout: OWNERSHIP_TIMEOUT_MS,
          });
          if (!rosterResponse.ok) {
            throw new Error(`HTTP ${rosterResponse.status}`);
          }

          const rosterRaw = await rosterResponse.json();
          const rosterTeamArray = getPath(rosterRaw, ['fantasy_content', 'team']);
          const rosterTeam = unwrapTeam(rosterTeamArray);

          return {
            teamKey,
            teamName:
              (typeof team.name === 'string' && team.name) ||
              (typeof rosterTeam.name === 'string' && rosterTeam.name) ||
              teamKey,
            ownerName: extractManagerName(team) ?? extractManagerName(rosterTeam),
            playerIds: extractRosterPlayerIds(rosterTeam),
          };
        } catch (error) {
          console.warn(
            `[yahoo-league-ownership] roster fetch failed for team ${teamKey}:`,
            error instanceof Error ? error.message : error,
          );
          return null;
        }
      }),
    );

    const ownerMap = new Map<string, YahooLeagueOwnerInfo>();
    let complete = true;
    for (const result of rosterResults) {
      if (result.status === 'rejected') {
        console.warn(
          '[yahoo-league-ownership] unexpected roster enrichment rejection:',
          result.reason instanceof Error ? result.reason.message : result.reason,
        );
        complete = false;
        continue;
      }

      const rosterEntry = result.value;
      if (!rosterEntry) {
        complete = false;
        continue;
      }

      for (const playerId of rosterEntry.playerIds) {
        ownerMap.set(playerId, {
          teamKey: rosterEntry.teamKey,
          teamName: rosterEntry.teamName,
          ownerName: rosterEntry.ownerName,
        });
      }
    }

    return { map: ownerMap, complete };
  } catch (error) {
    console.warn(
      '[yahoo-league-ownership] roster ownership enrichment failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export function enrichPlayerWithOwnership(
  playerId: string | number | undefined,
  ownership: YahooLeagueOwnershipResult | null,
): {
  league_status: 'ROSTERED' | 'FREE_AGENT' | null;
  league_team_name: string | null;
  league_owner_name: string | null;
} {
  if (!ownership) {
    return { league_status: null, league_team_name: null, league_owner_name: null };
  }

  const normalizedPlayerId =
    typeof playerId === 'string' || typeof playerId === 'number' ? String(playerId) : null;
  if (!normalizedPlayerId) {
    return { league_status: null, league_team_name: null, league_owner_name: null };
  }

  const owner = ownership.map.get(normalizedPlayerId);
  if (!owner) {
    // When ownership data is incomplete (a roster fetch failed), we can't tell a
    // real free agent apart from a player on the missing team. Surface null so
    // downstream doesn't falsely label rostered players as FREE_AGENT.
    return {
      league_status: ownership.complete ? 'FREE_AGENT' : null,
      league_team_name: null,
      league_owner_name: null,
    };
  }

  return {
    league_status: 'ROSTERED',
    league_team_name: owner.teamName,
    league_owner_name: owner.ownerName ?? null,
  };
}
