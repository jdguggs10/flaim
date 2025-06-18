/**
 * League Discovery MCP Tool
 * 
 * Integrates the V3 league discovery service as an MCP tool
 */

import { Env } from '../index.js';
import { EspnStorage, discoverLeaguesV3Safe } from '../../../../auth/espn/index.js';

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

    // Run V3 league discovery
    const discoveryResult = await discoverLeaguesV3Safe(credentials.swid, credentials.s2);
    
    if (!discoveryResult.success) {
      return {
        success: false,
        error: discoveryResult.error,
        shouldShowManualEntry: true
      };
    }

    const leagues = discoveryResult.leagues || [];
    const baseballLeagues = leagues.filter(l => l.gameId === 'flb');
    const footballLeagues = leagues.filter(l => l.gameId === 'ffl');

    return {
      success: true,
      data: {
        totalLeagues: leagues.length,
        baseballLeagues: baseballLeagues.map(league => ({
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          teamName: league.teamName,
          seasonId: league.seasonId
        })),
        footballLeagues: footballLeagues.map(league => ({
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          teamName: league.teamName,
          seasonId: league.seasonId
        })),
        allLeagues: leagues.map(league => ({
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          teamName: league.teamName,
          sport: league.gameId === 'flb' ? 'baseball' : 
                 league.gameId === 'ffl' ? 'football' : 
                 league.gameId === 'fba' ? 'basketball' :
                 league.gameId === 'fhl' ? 'hockey' :
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