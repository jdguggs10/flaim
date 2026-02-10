import type { LeagueConfig } from '@flaim/worker-shared';
import { authWorkerFetch, withCorrelationId } from '@flaim/worker-shared';
import type { Env, Sport } from '../types';
import { getCredentials } from '../shared/auth';
import { getBasicLeagueInfo } from './basic-league-info';

interface OnboardingResult<T> {
  status: number;
  body: T;
}

interface OnboardingInitializeRequest {
  sport?: string;
  leagueId?: string;
  seasonYear?: number;
}

interface DiscoverSeasonsRequest {
  sport?: string;
  leagueId?: string;
}

interface DiscoveredSeason {
  seasonYear: number;
  leagueName: string;
  teamCount: number;
  teamId?: string;
  teamName?: string;
}

const ESPN_GAME_IDS: Record<Sport, string> = {
  football: 'ffl',
  baseball: 'flb',
  basketball: 'fba',
  hockey: 'fhl'
};

function normalizeSport(input?: string): Sport | null {
  if (!input) return null;
  const normalized = input.toLowerCase();
  if (normalized === 'football' || normalized === 'baseball' || normalized === 'basketball' || normalized === 'hockey') {
    return normalized as Sport;
  }
  return null;
}

function getEspnGameId(sport: Sport): string {
  return ESPN_GAME_IDS[sport] || 'ffl';
}

function isOnboardingSport(sport: Sport): boolean {
  return sport === 'football' || sport === 'baseball' || sport === 'basketball' || sport === 'hockey';
}

function buildAuthHeaders(
  authHeader?: string | null,
  correlationId?: string,
  includeJson = false
): Headers {
  const headers: Record<string, string> = {};
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  return correlationId ? withCorrelationId(headers, correlationId) : new Headers(headers);
}

async function getUserLeagues(
  env: Env,
  authHeader?: string | null,
  correlationId?: string
): Promise<LeagueConfig[]> {
  const response = await authWorkerFetch(env, '/leagues', {
    method: 'GET',
    headers: buildAuthHeaders(authHeader, correlationId, true)
  });

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(`Auth-worker error: ${errorData.error || response.statusText}`);
  }

  const data = await response.json().catch(() => null) as { success?: boolean; leagues?: LeagueConfig[] } | null;
  if (!data?.success) {
    return [];
  }
  return data.leagues || [];
}

export async function initializeOnboarding(
  env: Env,
  body: OnboardingInitializeRequest,
  authHeader?: string | null,
  correlationId?: string
): Promise<OnboardingResult<Record<string, unknown>>> {
  try {
    if (!authHeader) {
      return {
        status: 401,
        body: { error: 'Authentication required' }
      };
    }

    const requestedSport = normalizeSport(body.sport);
    if (body.sport && !requestedSport) {
      return {
        status: 400,
        body: { error: 'Unsupported sport', code: 'SPORT_NOT_SUPPORTED' }
      };
    }

    const targetSport = requestedSport ?? 'football';
    if (!isOnboardingSport(targetSport)) {
      return {
        status: 400,
        body: { error: 'Sport not supported for onboarding yet', code: 'SPORT_NOT_SUPPORTED' }
      };
    }

    const credentials = await getCredentials(env, authHeader, correlationId);
    if (!credentials) {
      return {
        status: 404,
        body: {
          error: 'ESPN credentials not found. Please add your ESPN credentials first.',
          code: 'CREDENTIALS_MISSING'
        }
      };
    }

    let targetLeagues: LeagueConfig[] = [];

    if (body.leagueId) {
      targetLeagues = [{ leagueId: body.leagueId, sport: targetSport, seasonYear: body.seasonYear }];
    } else {
      const leagues = await getUserLeagues(env, authHeader, correlationId);
      targetLeagues = leagues.filter((league) => league.sport === targetSport);

      if (targetLeagues.length === 0) {
        return {
          status: 404,
          body: {
            error: `No ${targetSport} leagues found. Please add ${targetSport} leagues first.`,
            code: 'LEAGUES_MISSING'
          }
        };
      }
    }

    const leagueResults = [];
    for (const league of targetLeagues) {
      try {
        const leagueSeasonYear = league.seasonYear ?? body.seasonYear;
        const gameId = getEspnGameId(league.sport as Sport);
        const basicInfo = await getBasicLeagueInfo({
          leagueId: league.leagueId,
          sport: league.sport,
          gameId,
          credentials,
          seasonYear: leagueSeasonYear
        });

        leagueResults.push({
          ...basicInfo,
          leagueId: league.leagueId,
          sport: league.sport,
          teamId: league.teamId,
          seasonYear: leagueSeasonYear,
          gameId,
        });
      } catch (error) {
        console.error(`❌ Failed to get info for league ${league.leagueId}:`, error);
        leagueResults.push({
          leagueId: league.leagueId,
          sport: league.sport,
          teamId: league.teamId,
          gameId: getEspnGameId(league.sport as Sport),
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        message: 'Onboarding initialized successfully',
        sport: targetSport,
        totalLeagues: targetLeagues.length,
        leagues: leagueResults
      }
    };
  } catch (error) {
    console.error('❌ Onboarding initialize error:', error);
    return {
      status: 500,
      body: {
        error: 'Failed to initialize onboarding',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

export async function discoverSeasons(
  env: Env,
  body: DiscoverSeasonsRequest,
  authHeader?: string | null,
  correlationId?: string
): Promise<OnboardingResult<Record<string, unknown>>> {
  try {
    if (!authHeader) {
      return {
        status: 401,
        body: { error: 'Authentication required', code: 'AUTH_MISSING' }
      };
    }

    const leagueId = body.leagueId;
    if (!leagueId) {
      return {
        status: 400,
        body: { error: 'leagueId is required' }
      };
    }

    const requestedSport = normalizeSport(body.sport);
    if (body.sport && !requestedSport) {
      return {
        status: 400,
        body: { error: 'Unsupported sport', code: 'SPORT_NOT_SUPPORTED' }
      };
    }

    const targetSport = requestedSport ?? 'football';
    if (!isOnboardingSport(targetSport)) {
      return {
        status: 400,
        body: { error: 'Sport not supported for onboarding yet', code: 'SPORT_NOT_SUPPORTED' }
      };
    }

    const credentials = await getCredentials(env, authHeader, correlationId);
    if (!credentials) {
      return {
        status: 404,
        body: { error: 'ESPN credentials not found', code: 'CREDENTIALS_MISSING' }
      };
    }

    const leaguesResponse = await authWorkerFetch(env, '/leagues', {
      method: 'GET',
      headers: buildAuthHeaders(authHeader, correlationId)
    });
    const leaguesData = await leaguesResponse.json().catch(() => ({})) as {
      leagues?: Array<{ leagueId: string; sport: string; seasonYear?: number; teamId?: string }>;
    };

    const matchingLeagues = (leaguesData.leagues || []).filter(
      (league) => league.leagueId === leagueId && league.sport === targetSport
    );
    const baseTeamId = matchingLeagues.find((league) => league.teamId)?.teamId;

    if (!baseTeamId) {
      return {
        status: 400,
        body: { error: 'Team selection required before discovering seasons', code: 'TEAM_ID_MISSING' }
      };
    }

    const existingSeasons = new Set(
      matchingLeagues
        .map((league) => league.seasonYear)
        .filter((seasonYear): seasonYear is number => typeof seasonYear === 'number')
    );

    const MIN_YEAR = 2000;
    const MAX_CONSECUTIVE_MISSES = 2;
    const PROBE_DELAY_MS = 200;
    const currentYear = new Date().getFullYear();
    const gameId = getEspnGameId(targetSport);

    const discovered: DiscoveredSeason[] = [];
    let consecutiveMisses = 0;
    let skippedCount = 0;
    let rateLimited = false;
    let limitExceeded = false;
    let minYearReached = false;

    for (let year = currentYear; year >= MIN_YEAR; year--) {
      if (year === MIN_YEAR) {
        minYearReached = true;
      }

      if (existingSeasons.has(year)) {
        skippedCount++;
        continue;
      }

      const mustProbe = year >= currentYear - 1;
      if (!mustProbe && consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
        break;
      }

      if (discovered.length > 0 || consecutiveMisses > 0) {
        await new Promise((resolve) => setTimeout(resolve, PROBE_DELAY_MS));
      }

      const info = await getBasicLeagueInfo({
        leagueId,
        sport: targetSport,
        gameId,
        credentials,
        seasonYear: year
      });

      if (info.success && (!info.teams || info.teams.length === 0)) {
        consecutiveMisses++;
        continue;
      }

      if (info.success) {
        const matchedTeam = info.teams?.find((team) => team.teamId === baseTeamId);
        const seasonTeamName = matchedTeam?.teamName;
        discovered.push({
          seasonYear: year,
          leagueName: info.leagueName || `${targetSport} League ${leagueId}`,
          teamCount: info.teams?.length || 0,
          teamId: baseTeamId,
          teamName: seasonTeamName
        });
        consecutiveMisses = 0;

        try {
          const addResponse = await authWorkerFetch(env, '/leagues/add', {
            method: 'POST',
            headers: buildAuthHeaders(authHeader, correlationId, true),
            body: JSON.stringify({
              leagueId,
              sport: targetSport,
              seasonYear: year,
              leagueName: info.leagueName,
              teamId: baseTeamId,
              teamName: seasonTeamName
            })
          });

          if (addResponse.status === 409) {
            try {
              const patchResponse = await authWorkerFetch(env, `/leagues/${leagueId}/team`, {
                method: 'PATCH',
                headers: buildAuthHeaders(authHeader, correlationId, true),
                body: JSON.stringify({
                  teamId: baseTeamId,
                  sport: targetSport,
                  teamName: seasonTeamName,
                  leagueName: info.leagueName,
                  seasonYear: year
                })
              });

              if (!patchResponse.ok) {
                const patchError = await patchResponse.json().catch(() => ({})) as { error?: string };
                console.warn(`⚠️ [discover] Failed to backfill team for season ${year}: ${patchResponse.status} ${patchError.error || ''}`);
              }
            } catch (patchError) {
              console.warn(`⚠️ [discover] Error backfilling team for season ${year}:`, patchError);
            }
          } else if (addResponse.status === 400) {
            const addData = await addResponse.json().catch(() => ({})) as { code?: string };
            if (addData.code === 'LIMIT_EXCEEDED') {
              limitExceeded = true;
              break;
            }
          } else if (!addResponse.ok) {
            console.warn(`⚠️ [discover] Failed to save season ${year}: ${addResponse.status}`);
          }
        } catch (addError) {
          console.warn(`⚠️ [discover] Error saving season ${year}:`, addError);
        }

      } else if (info.httpStatus === 404) {
        consecutiveMisses++;
      } else if (info.httpStatus === 429) {
        rateLimited = true;
        break;
      } else if (info.httpStatus === 401 || info.httpStatus === 403) {
        const hasKnownSeason = discovered.length > 0 || existingSeasons.size > 0;
        if (hasKnownSeason) {
          consecutiveMisses++;
        } else {
          return {
            status: 401,
            body: { error: 'ESPN credentials expired or invalid', code: 'AUTH_FAILED' }
          };
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const retry = await getBasicLeagueInfo({
          leagueId,
          sport: targetSport,
          gameId,
          credentials,
          seasonYear: year
        });

        if (retry.success && (!retry.teams || retry.teams.length === 0)) {
          consecutiveMisses++;
          continue;
        }

        if (retry.success) {
          const matchedTeam = retry.teams?.find((team) => team.teamId === baseTeamId);
          const seasonTeamName = matchedTeam?.teamName;
          discovered.push({
            seasonYear: year,
            leagueName: retry.leagueName || `${targetSport} League ${leagueId}`,
            teamCount: retry.teams?.length || 0,
            teamId: baseTeamId,
            teamName: seasonTeamName
          });
          consecutiveMisses = 0;
          try {
            const addResponse = await authWorkerFetch(env, '/leagues/add', {
              method: 'POST',
              headers: buildAuthHeaders(authHeader, correlationId, true),
              body: JSON.stringify({
                leagueId,
                sport: targetSport,
                seasonYear: year,
                leagueName: retry.leagueName,
                teamId: baseTeamId,
                teamName: seasonTeamName
              })
            });

            if (addResponse.status === 409) {
              try {
                const patchResponse = await authWorkerFetch(env, `/leagues/${leagueId}/team`, {
                  method: 'PATCH',
                  headers: buildAuthHeaders(authHeader, correlationId, true),
                  body: JSON.stringify({
                    teamId: baseTeamId,
                    sport: targetSport,
                    teamName: seasonTeamName,
                    leagueName: retry.leagueName,
                    seasonYear: year
                  })
                });
                if (!patchResponse.ok) {
                  const patchError = await patchResponse.json().catch(() => ({})) as { error?: string };
                  console.warn(`⚠️ [discover] Failed to backfill team for season ${year} on retry: ${patchResponse.status} ${patchError.error || ''}`);
                }
              } catch (patchError) {
                console.warn(`⚠️ [discover] Error backfilling team for season ${year} on retry:`, patchError);
              }
            } else if (addResponse.status === 400) {
              const addData = await addResponse.json().catch(() => ({})) as { code?: string };
              if (addData.code === 'LIMIT_EXCEEDED') {
                limitExceeded = true;
                break;
              }
            }
          } catch {
            // Ignore save errors
          }
        } else if (retry.httpStatus === 404) {
          consecutiveMisses++;
        } else if (retry.httpStatus === 401 || retry.httpStatus === 403) {
          const hasKnownSeason = discovered.length > 0 || existingSeasons.size > 0;
          if (hasKnownSeason) {
            consecutiveMisses++;
          } else {
            return {
              status: 401,
              body: { error: 'ESPN credentials expired or invalid', code: 'AUTH_FAILED' }
            };
          }
        } else {
          return {
            status: 502,
            body: { error: `ESPN API error: ${retry.error}`, code: 'ESPN_ERROR' }
          };
        }
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        leagueId,
        sport: targetSport,
        startYear: currentYear,
        minYearReached,
        rateLimited,
        limitExceeded,
        discovered,
        skipped: skippedCount,
        ...(limitExceeded ? { error: 'League limit reached - some seasons may not have been saved' } : {})
      }
    };
  } catch (error) {
    console.error('❌ Discover seasons error:', error);
    return {
      status: 500,
      body: {
        error: 'Failed to discover seasons',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}
