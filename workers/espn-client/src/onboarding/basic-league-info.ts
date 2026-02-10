import type { EspnCredentials } from '@flaim/worker-shared';
import type { EspnLeagueResponse } from '../types';
import { espnFetch } from '../shared/espn-api';
import { toEspnSeasonYear } from '../shared/season';

export interface BasicLeagueInfoRequest {
  leagueId: string;
  sport: string;
  gameId: string;
  credentials: EspnCredentials;
  seasonYear?: number;
}

export interface BasicLeagueInfoResponse {
  success: boolean;
  leagueName?: string;
  seasonYear?: number;
  standings?: Array<{
    teamId: string;
    teamName: string;
    wins: number;
    losses: number;
    ties: number;
    winPercentage: number;
    rank: number;
    playoffSeed?: number;
  }>;
  teams?: Array<{
    teamId: string;
    teamName: string;
    ownerName?: string;
  }>;
  error?: string;
  httpStatus?: number;
}

export async function getBasicLeagueInfo(
  request: BasicLeagueInfoRequest
): Promise<BasicLeagueInfoResponse> {
  try {
    const { leagueId, gameId, credentials, sport, seasonYear: requestedSeasonYear } = request;

    if (!leagueId || !gameId || !credentials?.swid || !credentials?.s2) {
      return {
        success: false,
        error: 'Missing required parameters: leagueId, gameId, swid, s2',
        httpStatus: 400
      };
    }

    const seasonYear = requestedSeasonYear || new Date().getFullYear();
    const espnSeasonYear = toEspnSeasonYear(seasonYear, sport);
    const apiPath = `/seasons/${espnSeasonYear}/segments/0/leagues/${leagueId}?view=mStandings&view=mTeam&view=mSettings`;

    let response: Response;
    try {
      response = await espnFetch(apiPath, gameId, {
        credentials,
        timeout: 7000,
        headers: {
          'User-Agent': 'flaim-onboarding-autopull/1.0'
        }
      });
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return {
          success: false,
          error: 'ESPN API request timed out - try again',
          httpStatus: 504
        };
      }
      throw fetchError;
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: 'ESPN authentication failed - please verify your cookies are current and valid',
        httpStatus: response.status
      };
    }

    if (response.status === 404) {
      return {
        success: false,
        error: 'League not found - please check your league ID and sport selection',
        httpStatus: 404
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        error: 'ESPN API rate limited - try again later',
        httpStatus: 429
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `ESPN API error: ${response.status} ${response.statusText}`,
        httpStatus: response.status
      };
    }

    const responseText = await response.text();

    let data: EspnLeagueResponse;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
        return {
          success: false,
          error: 'ESPN returned HTML instead of JSON - likely authentication failure',
          httpStatus: 401
        };
      }
      return {
        success: false,
        error: 'Invalid response format from ESPN API',
        httpStatus: 500
      };
    }

    const sportLabel = sport ? `${sport.charAt(0).toUpperCase()}${sport.slice(1)}` : 'League';
    const leagueName = data.settings?.name || `${sportLabel} League ${leagueId}`;
    const returnedSeasonYear = data.seasonId || seasonYear;

    const teams = (data.teams || []).map((team) => ({
      teamId: team.id?.toString() || '',
      teamName: team.location && team.nickname
        ? `${team.location} ${team.nickname}`
        : team.name || `Team ${team.id}`,
      ownerName: team.owners?.[0]?.displayName || team.owners?.[0]?.firstName || undefined
    }));

    const standings = (data.teams || []).map((team) => {
      const record = team.record?.overall;
      const wins = record?.wins || 0;
      const losses = record?.losses || 0;
      const ties = record?.ties || 0;
      const totalGames = wins + losses + ties;
      const winPercentage = totalGames > 0 ? wins / totalGames : 0;

      return {
        teamId: team.id?.toString() || '',
        teamName: team.location && team.nickname
          ? `${team.location} ${team.nickname}`
          : team.name || `Team ${team.id}`,
        wins,
        losses,
        ties,
        winPercentage: Math.round(winPercentage * 1000) / 1000,
        rank: team.playoffSeed || team.rank || 0,
        playoffSeed: team.playoffSeed || undefined
      };
    }).sort((a, b) => {
      if (b.winPercentage !== a.winPercentage) {
        return b.winPercentage - a.winPercentage;
      }
      return b.wins - a.wins;
    }).map((team, index) => ({
      ...team,
      rank: index + 1
    }));

    return {
      success: true,
      leagueName,
      seasonYear: returnedSeasonYear,
      standings,
      teams
    };

  } catch (error) {
    console.error(`Basic ${request.sport || 'league'} info error:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      httpStatus: 500
    };
  }
}
