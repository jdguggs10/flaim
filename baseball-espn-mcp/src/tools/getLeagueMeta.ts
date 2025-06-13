import { EspnApiClient } from '../espn';
import { Env } from '../index';

export async function getLeagueMeta(
  args: { leagueId: string; year?: number },
  env: Env
) {
  const client = new EspnApiClient(env);
  
  try {
    const league = await client.fetchLeague(args.leagueId, args.year || 2025);
    
    // Validate that we got a valid league response
    if (!league || !league.settings) {
      throw new Error('Invalid league data received from ESPN API');
    }
    
    return {
      success: true,
      data: {
        id: league.id,
        name: league.settings.name,
        size: league.settings.size,
        status: league.status,
        scoringPeriodId: league.scoringPeriodId,
        currentMatchupPeriod: league.currentMatchupPeriod,
        seasonId: league.seasonId,
        segmentId: league.segmentId,
        scoringSettings: {
          type: league.settings.scoringSettings?.scoringType,
          matchupPeriods: league.settings.scoringSettings?.matchupPeriods,
          playoffTeamCount: league.settings.playoffTeamCount,
          regularSeasonMatchupPeriods: league.settings.regularSeasonMatchupPeriods
        },
        roster: {
          lineupSlotCounts: league.settings.rosterSettings?.lineupSlotCounts,
          positionLimits: league.settings.rosterSettings?.positionLimits
        },
        schedule: {
          playoffSeedingRule: league.settings.scheduleSettings?.playoffSeedingRule,
          playoffMatchupPeriodLength: league.settings.scheduleSettings?.playoffMatchupPeriodLength
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      leagueId: args.leagueId,
      year: args.year || 2025
    };
  }
}