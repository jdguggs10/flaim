/**
 * Basic League Information MCP Tool
 * 
 * Provides essential league data for the onboarding auto-pull feature:
 * - League name and season information
 * - Complete standings with team rankings
 * - Team list for user selection
 */


interface BasicLeagueInfoRequest {
  leagueId: string;
  sport: string;
  gameId: string;
  credentials: {
    swid: string;
    s2: string;
  };
}

interface BasicLeagueInfoResponse {
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
}

export async function getBasicLeagueInfo(
  request: BasicLeagueInfoRequest
): Promise<BasicLeagueInfoResponse> {
  try {
    const { leagueId, gameId, credentials } = request;
    
    if (!leagueId || !gameId || !credentials.swid || !credentials.s2) {
      return {
        success: false,
        error: 'Missing required parameters: leagueId, gameId, swid, s2'
      };
    }

    const currentYear = new Date().getFullYear();
    const apiUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${gameId}/seasons/${currentYear}/segments/0/leagues/${leagueId}?view=mStandings&view=mTeam&view=mSettings`;

    console.log(`🏈 Fetching basic league info: ${apiUrl}`);
    console.log(`🍪 Using credentials: SWID=${credentials.swid.substring(0, 10)}... s2=${credentials.s2.substring(0, 20)}...`);

    // Create AbortController for 7-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    let response;
    try {
      response = await fetch(apiUrl, {
        headers: {
          'Cookie': `SWID=${credentials.swid}; espn_s2=${credentials.s2}`,
          'User-Agent': 'flaim-onboarding-autopull/1.0',
          'Accept': 'application/json',
          'X-Fantasy-Source': 'kona',
          'X-Fantasy-Platform': 'kona-web-2.0.0'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return {
          success: false,
          error: 'ESPN API request timed out - try again'
        };
      }
      throw fetchError;
    }

    console.log(`📡 ESPN API Response: ${response.status} ${response.statusText}`);

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: 'ESPN authentication failed - please verify your cookies are current and valid'
      };
    }

    if (response.status === 404) {
      return {
        success: false,
        error: 'League not found - please check your league ID and sport selection'
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `ESPN API error: ${response.status} ${response.statusText}`
      };
    }

    const responseText = await response.text();
    console.log(`📝 Response (first 300 chars): ${responseText.substring(0, 300)}`);

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Failed to parse JSON:', parseError);
      if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
        return {
          success: false,
          error: 'ESPN returned HTML instead of JSON - likely authentication failure'
        };
      }
      return {
        success: false,
        error: 'Invalid response format from ESPN API'
      };
    }

    // Extract basic league information
    const leagueName = data.settings?.name || `League ${leagueId}`;
    const seasonYear = data.seasonId || currentYear;

    // Extract teams information
    const teams = (data.teams || []).map((team: any) => ({
      teamId: team.id?.toString() || '',
      teamName: team.location && team.nickname ? 
                `${team.location} ${team.nickname}` : 
                team.name || `Team ${team.id}`,
      ownerName: team.owners?.[0]?.displayName || team.owners?.[0]?.firstName || undefined
    }));

    // Extract standings information
    const standings = (data.teams || []).map((team: any) => {
      const record = team.record?.overall || {};
      const wins = record.wins || 0;
      const losses = record.losses || 0;
      const ties = record.ties || 0;
      const totalGames = wins + losses + ties;
      const winPercentage = totalGames > 0 ? wins / totalGames : 0;

      return {
        teamId: team.id?.toString() || '',
        teamName: team.location && team.nickname ? 
                  `${team.location} ${team.nickname}` : 
                  team.name || `Team ${team.id}`,
        wins,
        losses,
        ties,
        winPercentage: Math.round(winPercentage * 1000) / 1000, // Round to 3 decimal places
        rank: team.playoffSeed || team.rank || 0,
        playoffSeed: team.playoffSeed || undefined
      };
    }).sort((a: any, b: any) => {
      // Sort by win percentage descending, then by wins descending
      if (b.winPercentage !== a.winPercentage) {
        return b.winPercentage - a.winPercentage;
      }
      return b.wins - a.wins;
    }).map((team: any, index: number) => ({
      ...team,
      rank: index + 1 // Assign rank based on sorted position
    }));

    console.log(`✅ Successfully retrieved league info: ${leagueName} (${teams.length} teams)`);

    return {
      success: true,
      leagueName,
      seasonYear,
      standings,
      teams
    };

  } catch (error) {
    console.error('Basic league info error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}