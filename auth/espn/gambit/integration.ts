/**
 * Integration helpers for ESPN League Discovery
 * 
 * Provides utilities to integrate league discovery with the existing
 * FLAIM authentication and MCP systems.
 */

import { EspnCredentials } from '../types.js';
import { discoverLeaguesSafe, GambitLeague, filterLeaguesBySport } from './index.js';

/**
 * Integration result for league discovery
 */
export interface LeagueDiscoveryIntegrationResult {
  success: boolean;
  leagues: GambitLeague[];
  baseballLeagues: GambitLeague[];
  footballLeagues: GambitLeague[];
  error?: string;
  shouldShowManualEntry: boolean;
}

/**
 * Discover leagues using stored ESPN credentials
 * 
 * @param credentials ESPN credentials from user storage
 * @returns Promise<LeagueDiscoveryIntegrationResult>
 */
export async function discoverLeaguesWithCredentials(
  credentials: EspnCredentials
): Promise<LeagueDiscoveryIntegrationResult> {
  
  const result = await discoverLeaguesSafe(credentials.swid, credentials.espn_s2);
  
  if (!result.success) {
    return {
      success: false,
      leagues: [],
      baseballLeagues: [],
      footballLeagues: [],
      error: result.error,
      shouldShowManualEntry: true
    };
  }

  // Separate leagues by sport for easier consumption
  const baseballLeagues = filterLeaguesBySport(result.leagues, 'flb');
  const footballLeagues = filterLeaguesBySport(result.leagues, 'ffl');

  return {
    success: true,
    leagues: result.leagues,
    baseballLeagues,
    footballLeagues,
    shouldShowManualEntry: result.leagues.length === 0
  };
}

/**
 * Auto-discovery workflow for post-authentication
 * 
 * This function should be called after ESPN credentials are successfully saved.
 * It attempts to discover leagues and returns formatted data for the UI.
 */
export async function runPostAuthLeagueDiscovery(
  clerkUserId: string,
  credentials: EspnCredentials
): Promise<{
  discoveryResult: LeagueDiscoveryIntegrationResult;
  uiMessage: string;
  mcpConfigSuggestions: Array<{
    sport: string;
    leagueId: string;
    leagueName: string;
    serverUrl: string;
  }>;
}> {
  
  console.log(`🔍 Running post-auth league discovery for user ${clerkUserId}`);
  
  const discoveryResult = await discoverLeaguesWithCredentials(credentials);
  
  // Generate UI messages based on results
  let uiMessage: string;
  if (!discoveryResult.success) {
    uiMessage = `League auto-discovery failed: ${discoveryResult.error}. You can manually enter league IDs below.`;
  } else if (discoveryResult.leagues.length === 0) {
    uiMessage = 'No active fantasy leagues found. You can manually enter league IDs below.';
  } else {
    const sportCounts = {
      baseball: discoveryResult.baseballLeagues.length,
      football: discoveryResult.footballLeagues.length
    };
    
    const sportMessages = [];
    if (sportCounts.baseball > 0) {
      sportMessages.push(`${sportCounts.baseball} baseball league${sportCounts.baseball > 1 ? 's' : ''}`);
    }
    if (sportCounts.football > 0) {
      sportMessages.push(`${sportCounts.football} football league${sportCounts.football > 1 ? 's' : ''}`);
    }
    
    uiMessage = `🎉 Discovered ${discoveryResult.leagues.length} league${discoveryResult.leagues.length > 1 ? 's' : ''}: ${sportMessages.join(' and ')}.`;
  }

  // Generate MCP configuration suggestions
  const mcpConfigSuggestions = [];
  
  // Baseball leagues
  for (const league of discoveryResult.baseballLeagues) {
    mcpConfigSuggestions.push({
      sport: 'baseball',
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      serverUrl: 'https://baseball-espn-mcp.your-domain.workers.dev/mcp' // This should be configurable
    });
  }
  
  // Football leagues  
  for (const league of discoveryResult.footballLeagues) {
    mcpConfigSuggestions.push({
      sport: 'football',
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      serverUrl: 'https://football-espn-mcp.your-domain.workers.dev/mcp' // This should be configurable
    });
  }

  return {
    discoveryResult,
    uiMessage,
    mcpConfigSuggestions
  };
}

/**
 * Helper to create MCP tool configuration for discovered leagues
 */
export function createMcpConfigForLeague(
  league: GambitLeague, 
  baseServerUrl?: string
): {
  server_label: string;
  server_url: string;
  allowed_tools: string;
  skip_approval: boolean;
  league_context: {
    leagueId: string;
    leagueName: string;
    sport: string;
    teamName: string;
  };
} {
  
  const sportName = league.gameId === 'flb' ? 'baseball' : 
                   league.gameId === 'ffl' ? 'football' : 
                   league.gameId;
  
  const serverUrl = baseServerUrl || 
    (league.gameId === 'flb' ? 'https://baseball-espn-mcp.your-domain.workers.dev/mcp' :
     league.gameId === 'ffl' ? 'https://football-espn-mcp.your-domain.workers.dev/mcp' :
     'https://espn-mcp.your-domain.workers.dev/mcp');

  const allowedTools = league.gameId === 'flb' 
    ? 'get_espn_league_info,get_espn_team_roster,get_espn_matchups'
    : league.gameId === 'ffl'
    ? 'get_espn_football_league_info,get_espn_football_team,get_espn_football_matchups,get_espn_football_standings'
    : 'get_espn_league_info';

  return {
    server_label: `${sportName}-${league.leagueName.replace(/\s+/g, '-').toLowerCase()}`,
    server_url: serverUrl,
    allowed_tools: allowedTools,
    skip_approval: true,
    league_context: {
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      sport: sportName,
      teamName: league.teamName
    }
  };
}