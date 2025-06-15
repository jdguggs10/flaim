/**
 * League Discovery MCP Tool
 * 
 * Integrates the gambit league discovery service as an MCP tool
 */

import { Env } from '../index.js';
import { EspnStorage } from '../../../../auth/espn/index.js';
import { discoverLeaguesWithCredentials } from '../../../../auth/espn/gambit/integration.js';

export async function discoverUserLeagues(
  args: { clerkUserId?: string },
  env: Env
) {
  const clerkUserId = args.clerkUserId;
  
  if (!clerkUserId) {
    return {
      success: false,
      error: 'Clerk user ID required for league discovery'
    };
  }

  try {
    // Get ESPN credentials for the user
    const credentials = await EspnStorage.getEspnCredentialsForMcp(env, clerkUserId);
    
    if (!credentials) {
      return {
        success: false,
        error: 'ESPN credentials not found. Please authenticate with ESPN first.',
        requiresAuth: true
      };
    }

    // Run league discovery
    const discoveryResult = await discoverLeaguesWithCredentials(credentials);
    
    if (!discoveryResult.success) {
      return {
        success: false,
        error: discoveryResult.error,
        shouldShowManualEntry: true
      };
    }

    return {
      success: true,
      data: {
        totalLeagues: discoveryResult.leagues.length,
        baseballLeagues: discoveryResult.baseballLeagues.map(league => ({
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          teamName: league.teamName,
          seasonId: league.seasonId
        })),
        footballLeagues: discoveryResult.footballLeagues.map(league => ({
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          teamName: league.teamName,
          seasonId: league.seasonId
        })),
        allLeagues: discoveryResult.leagues.map(league => ({
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          teamName: league.teamName,
          sport: league.gameId === 'flb' ? 'baseball' : 
                 league.gameId === 'ffl' ? 'football' : 
                 league.gameId,
          seasonId: league.seasonId
        }))
      }
    };
    
  } catch (error) {
    console.error('League discovery error:', error);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during league discovery'
    };
  }
}