/**
 * ESPN League Teams Fetcher (v3 API)
 * ---------------------------------------------------------------------------
 * Fetches team list for a specific ESPN fantasy league season.
 * Used by historical season discovery to validate team membership.
 */
import {
  EspnAuthenticationFailed,
  EspnCredentialsRequired,
  EspnApiError,
  gameIdToSport,
} from '../espn-types';
import { getDefaultSeasonYear, toCanonicalYear } from '../season-utils';
import { fetchEspnLeagueSeason, unwrapEspnLeaguePayload } from '@flaim/worker-shared';

/**
 * Team info returned from ESPN API
 */
export interface LeagueTeam {
  teamId: string;
  teamName: string;
}

interface EspnTeamResponse {
  teams?: Array<{
    id: number | string;
    name?: string;
    location?: string;
    nickname?: string;
  }>;
}

function isEspnTeamResponse(value: unknown): value is EspnTeamResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const teams = (value as Record<string, unknown>).teams;
  return teams === undefined || Array.isArray(teams);
}

/**
 * Fetches team list for an ESPN fantasy league season
 * @param swid - ESPN SWID cookie value
 * @param s2 - ESPN espn_s2 cookie value
 * @param leagueId - ESPN league ID
 * @param season - Season year
 * @param gameId - ESPN game ID (ffl, flb, fba, fhl)
 * @returns Array of teams in the league
 * @throws {EspnAuthenticationFailed} If authentication fails (401/403)
 * @throws {EspnApiError} For other API errors
 */
export async function getLeagueTeams(
  swid: string,
  s2: string,
  leagueId: string,
  season: number,
  gameId: string
): Promise<LeagueTeam[]> {
  if (!swid || !s2) {
    throw new EspnCredentialsRequired('Both SWID and espn_s2 cookies are required');
  }
  if (!leagueId) {
    throw new Error('League ID is required');
  }

  const sport = gameIdToSport(gameId);
  const historical = sport
    ? toCanonicalYear(season, sport, 'espn') < getDefaultSeasonYear(sport)
    : true;
  const response = await fetchEspnLeagueSeason({
    espnSeasonYear: season,
    leagueId,
    query: 'view=mStandings&view=mTeam',
    historical,
  }, (path) => fetch(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${gameId}${path}`,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': `SWID=${swid}; espn_s2=${s2}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'X-Fantasy-Source': 'kona',
        'X-Fantasy-Platform': 'kona-web-2.0.0'
      },
      signal: AbortSignal.timeout(7000) // 7 second timeout
    },
  ));

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new EspnAuthenticationFailed('ESPN authentication failed');
    }
    throw new EspnApiError(`ESPN API error: ${response.status} ${response.statusText}`);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new EspnApiError('Invalid JSON response from ESPN API');
  }

  const data = unwrapEspnLeaguePayload(parsed);
  if (!isEspnTeamResponse(data) || !data.teams) {
    return [];
  }

  return data.teams.map(team => ({
    teamId: String(team.id),
    teamName: team.name || `${team.location || ''} ${team.nickname || ''}`.trim() || `Team ${team.id}`
  }));
}
