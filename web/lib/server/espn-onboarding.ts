import type { AutoPullResponse, EspnLeagueInfo, SportName } from '@/lib/espn-types';

interface EspnCredentials {
  swid: string;
  s2: string;
  email?: string;
}

interface LeagueConfig {
  leagueId: string;
  sport: string;
  teamId?: string;
  seasonYear?: number;
}

interface DiscoveredSeason {
  seasonYear: number;
  leagueName: string;
  teamCount: number;
  teamId?: string;
  teamName?: string;
}

interface EspnApiTeam {
  id?: number;
  name?: string;
  location?: string;
  nickname?: string;
  playoffSeed?: number;
  rank?: number;
  owners?: Array<{ displayName?: string; firstName?: string }>;
  record?: { overall?: { wins?: number; losses?: number; ties?: number } };
}

interface EspnLeagueResponse {
  seasonId?: number;
  settings?: { name?: string };
  teams?: EspnApiTeam[];
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
  httpStatus?: number;
}

interface RouteResult<T> {
  status: number;
  body: T;
}

const INTERNAL_SERVICE_TOKEN_HEADER = 'X-Flaim-Internal-Token';
const ESPN_BASE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3';

const ESPN_GAME_IDS: Record<SportName, string> = {
  football: 'ffl',
  baseball: 'flb',
  basketball: 'fba',
  hockey: 'fhl',
};

function getAuthWorkerUrl(): string {
  const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
  if (!authWorkerUrl) {
    throw new Error('NEXT_PUBLIC_AUTH_WORKER_URL is not configured');
  }
  return authWorkerUrl;
}

function getInternalServiceToken(): string {
  const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalServiceToken) {
    throw new Error('INTERNAL_SERVICE_TOKEN is not configured');
  }
  return internalServiceToken;
}

function buildAuthHeaders(
  authHeader?: string | null,
  correlationId?: string,
  includeJson = false,
  includeInternalServiceToken = false
): Headers {
  const headers = new Headers();
  if (authHeader) {
    headers.set('Authorization', authHeader);
  }
  if (includeJson) {
    headers.set('Content-Type', 'application/json');
  }
  if (correlationId) {
    headers.set('X-Correlation-ID', correlationId);
  }
  if (includeInternalServiceToken) {
    headers.set(INTERNAL_SERVICE_TOKEN_HEADER, getInternalServiceToken());
  }
  return headers;
}

function normalizeSport(input?: string): SportName | null {
  if (!input) return null;
  const normalized = input.toLowerCase();
  if (normalized === 'football' || normalized === 'baseball' || normalized === 'basketball' || normalized === 'hockey') {
    return normalized as SportName;
  }
  return null;
}

function toEspnSeasonYear(canonicalYear: number, sport: string): number {
  if (sport === 'basketball' || sport === 'hockey') {
    return canonicalYear + 1;
  }
  return canonicalYear;
}

async function fetchEspnCredentials(
  authHeader: string,
  correlationId?: string
): Promise<EspnCredentials | null> {
  const response = await fetch(`${getAuthWorkerUrl()}/internal/credentials/espn/raw`, {
    method: 'GET',
    headers: buildAuthHeaders(authHeader, correlationId, false, true),
    cache: 'no-store',
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(errorData.error || errorData.message || response.statusText);
  }

  const data = await response.json() as { success?: boolean; credentials?: EspnCredentials };
  if (!data.success || !data.credentials) {
    throw new Error('Invalid credentials response from auth-worker');
  }

  return data.credentials;
}

async function getUserLeagues(
  authHeader: string,
  correlationId?: string
): Promise<LeagueConfig[]> {
  const response = await fetch(`${getAuthWorkerUrl()}/leagues`, {
    method: 'GET',
    headers: buildAuthHeaders(authHeader, correlationId, true),
    cache: 'no-store',
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

async function addLeague(
  authHeader: string,
  league: Record<string, unknown>,
  correlationId?: string
): Promise<Response> {
  return fetch(`${getAuthWorkerUrl()}/leagues/add`, {
    method: 'POST',
    headers: buildAuthHeaders(authHeader, correlationId, true),
    body: JSON.stringify(league),
    cache: 'no-store',
  });
}

async function patchLeagueTeam(
  authHeader: string,
  leagueId: string,
  body: Record<string, unknown>,
  correlationId?: string
): Promise<Response> {
  return fetch(`${getAuthWorkerUrl()}/leagues/${encodeURIComponent(leagueId)}/team`, {
    method: 'PATCH',
    headers: buildAuthHeaders(authHeader, correlationId, true),
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

async function espnFetch(
  path: string,
  gameId: string,
  credentials: EspnCredentials,
  timeout = 7000,
  additionalHeaders: Record<string, string> = {}
): Promise<Response> {
  const url = `${ESPN_BASE_URL}/games/${gameId}${path}`;
  const headers: Record<string, string> = {
    'User-Agent': 'flaim-onboarding-autopull/1.0',
    'Accept': 'application/json',
    'X-Fantasy-Source': 'kona',
    'X-Fantasy-Platform': 'kona-web-2.0.0',
    Cookie: `SWID=${credentials.swid}; espn_s2=${credentials.s2}`,
    ...additionalHeaders,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function getBasicLeagueInfo(
  leagueId: string,
  sport: SportName,
  credentials: EspnCredentials,
  seasonYear?: number
): Promise<BasicLeagueInfoResponse> {
  try {
    const requestedSeasonYear = seasonYear || new Date().getFullYear();
    const espnSeasonYear = toEspnSeasonYear(requestedSeasonYear, sport);
    const gameId = ESPN_GAME_IDS[sport];
    const apiPath = `/seasons/${espnSeasonYear}/segments/0/leagues/${leagueId}?view=mStandings&view=mTeam&view=mSettings`;

    let response: Response;
    try {
      response = await espnFetch(apiPath, gameId, credentials);
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return { success: false, error: 'ESPN API request timed out - try again', httpStatus: 504 };
      }
      throw fetchError;
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: 'ESPN authentication failed - please verify your cookies are current and valid',
        httpStatus: response.status,
      };
    }

    if (response.status === 404) {
      return {
        success: false,
        error: 'League not found - please check your league ID and sport selection',
        httpStatus: 404,
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        error: 'ESPN API rate limited - try again later',
        httpStatus: 429,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `ESPN API error: ${response.status} ${response.statusText}`,
        httpStatus: response.status,
      };
    }

    const responseText = await response.text();
    let data: EspnLeagueResponse;
    try {
      data = JSON.parse(responseText) as EspnLeagueResponse;
    } catch {
      if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
        return {
          success: false,
          error: 'ESPN returned HTML instead of JSON - likely authentication failure',
          httpStatus: 401,
        };
      }
      return {
        success: false,
        error: 'Invalid response format from ESPN API',
        httpStatus: 500,
      };
    }

    const leagueName = data.settings?.name || `${sport.charAt(0).toUpperCase()}${sport.slice(1)} League ${leagueId}`;
    const returnedSeasonYear = data.seasonId || requestedSeasonYear;

    const teams = (data.teams || []).map((team) => ({
      teamId: team.id?.toString() || '',
      teamName: team.location && team.nickname
        ? `${team.location} ${team.nickname}`
        : team.name || `Team ${team.id}`,
      ownerName: team.owners?.[0]?.displayName || team.owners?.[0]?.firstName || undefined,
    }));

    const standings = (data.teams || []).map((team) => {
      const wins = team.record?.overall?.wins || 0;
      const losses = team.record?.overall?.losses || 0;
      const ties = team.record?.overall?.ties || 0;
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
        playoffSeed: team.playoffSeed || undefined,
      };
    }).sort((a, b) => {
      if (b.winPercentage !== a.winPercentage) {
        return b.winPercentage - a.winPercentage;
      }
      return b.wins - a.wins;
    }).map((team, index) => ({
      ...team,
      rank: index + 1,
    }));

    return {
      success: true,
      leagueName,
      seasonYear: returnedSeasonYear,
      standings,
      teams,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      httpStatus: 500,
    };
  }
}

export async function runEspnAutoPull(params: {
  sport?: string;
  leagueId?: string;
  seasonYear?: number;
  authHeader: string;
  correlationId?: string;
}): Promise<RouteResult<AutoPullResponse | { error: string; code?: string }>> {
  const { sport, leagueId, seasonYear, authHeader, correlationId } = params;

  if (!sport || !leagueId) {
    return { status: 400, body: { error: 'Missing required fields: sport and leagueId' } };
  }

  const targetSport = normalizeSport(sport);
  if (!targetSport) {
    return { status: 400, body: { error: 'Unsupported sport', code: 'SPORT_NOT_SUPPORTED' } };
  }

  const credentials = await fetchEspnCredentials(authHeader, correlationId);
  if (!credentials) {
    return {
      status: 404,
      body: {
        error: 'ESPN credentials not found. Please add your ESPN credentials first.',
        code: 'CREDENTIALS_MISSING',
      },
    };
  }

  const leagueInfo = await getBasicLeagueInfo(leagueId, targetSport, credentials, seasonYear);
  if (!leagueInfo.success) {
    return {
      status: leagueInfo.httpStatus || 502,
      body: { error: leagueInfo.error || 'Failed to retrieve league information' },
    };
  }

  const responseLeagueInfo: EspnLeagueInfo = {
    leagueId,
    leagueName: leagueInfo.leagueName || `${targetSport} League ${leagueId}`,
    sport: targetSport,
    seasonYear: leagueInfo.seasonYear || seasonYear || new Date().getFullYear(),
    gameId: ESPN_GAME_IDS[targetSport],
    standings: leagueInfo.standings || [],
    teams: leagueInfo.teams || [],
  };

  if (!responseLeagueInfo.teams.length) {
    const suggestedYear = responseLeagueInfo.seasonYear === new Date().getFullYear()
      ? responseLeagueInfo.seasonYear - 1
      : responseLeagueInfo.seasonYear;
    return {
      status: 404,
      body: {
        error: `No teams found for ${targetSport} league ${leagueId} in season ${responseLeagueInfo.seasonYear}. Try season ${suggestedYear} instead.`,
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      leagueInfo: responseLeagueInfo,
    },
  };
}

export async function runEspnDiscoverSeasons(params: {
  sport?: string;
  leagueId?: string;
  authHeader: string;
  correlationId?: string;
}): Promise<RouteResult<Record<string, unknown>>> {
  const { sport, leagueId, authHeader, correlationId } = params;

  if (!leagueId) {
    return { status: 400, body: { error: 'leagueId is required' } };
  }

  const targetSport = normalizeSport(sport);
  if (!targetSport) {
    return { status: 400, body: { error: 'Unsupported sport', code: 'SPORT_NOT_SUPPORTED' } };
  }

  const credentials = await fetchEspnCredentials(authHeader, correlationId);
  if (!credentials) {
    return { status: 404, body: { error: 'ESPN credentials not found', code: 'CREDENTIALS_MISSING' } };
  }

  const leagues = await getUserLeagues(authHeader, correlationId);
  const matchingLeagues = leagues.filter((league) => league.leagueId === leagueId && league.sport === targetSport);
  const baseTeamId = matchingLeagues.find((league) => league.teamId)?.teamId;

  if (!baseTeamId) {
    return { status: 400, body: { error: 'Team selection required before discovering seasons', code: 'TEAM_ID_MISSING' } };
  }

  const existingSeasons = new Set(
    matchingLeagues
      .map((league) => league.seasonYear)
      .filter((value): value is number => typeof value === 'number')
  );

  const MIN_YEAR = 2000;
  const MAX_CONSECUTIVE_MISSES = 2;
  const PROBE_DELAY_MS = 200;
  const currentYear = new Date().getFullYear();
  const discovered: DiscoveredSeason[] = [];
  let consecutiveMisses = 0;
  let skippedCount = 0;
  let rateLimited = false;
  let limitExceeded = false;
  let minYearReached = false;

  for (let year = currentYear; year >= MIN_YEAR; year -= 1) {
    if (year === MIN_YEAR) {
      minYearReached = true;
    }

    if (existingSeasons.has(year)) {
      skippedCount += 1;
      continue;
    }

    const mustProbe = year >= currentYear - 1;
    if (!mustProbe && consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
      break;
    }

    if (discovered.length > 0 || consecutiveMisses > 0) {
      await new Promise((resolve) => setTimeout(resolve, PROBE_DELAY_MS));
    }

    const info = await getBasicLeagueInfo(leagueId, targetSport, credentials, year);

    if (info.success && (!info.teams || info.teams.length === 0)) {
      consecutiveMisses += 1;
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
        teamName: seasonTeamName,
      });
      consecutiveMisses = 0;

      try {
        const addResponse = await addLeague(authHeader, {
          leagueId,
          sport: targetSport,
          seasonYear: year,
          leagueName: info.leagueName,
          teamId: baseTeamId,
          teamName: seasonTeamName,
        }, correlationId);

        if (addResponse.status === 409) {
          await patchLeagueTeam(authHeader, leagueId, {
            teamId: baseTeamId,
            sport: targetSport,
            teamName: seasonTeamName,
            leagueName: info.leagueName,
            seasonYear: year,
          }, correlationId);
        } else if (addResponse.status === 400) {
          const addData = await addResponse.json().catch(() => ({})) as { code?: string };
          if (addData.code === 'LIMIT_EXCEEDED') {
            limitExceeded = true;
            break;
          }
        }
      } catch {
        // Ignore save errors and continue discovery.
      }

      continue;
    }

    if (info.httpStatus === 404) {
      consecutiveMisses += 1;
      continue;
    }

    if (info.httpStatus === 429) {
      rateLimited = true;
      break;
    }

    if (info.httpStatus === 401 || info.httpStatus === 403) {
      const hasKnownSeason = discovered.length > 0 || existingSeasons.size > 0;
      if (hasKnownSeason) {
        consecutiveMisses += 1;
        continue;
      }
      return { status: 401, body: { error: 'ESPN credentials expired or invalid', code: 'AUTH_FAILED' } };
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const retry = await getBasicLeagueInfo(leagueId, targetSport, credentials, year);

    if (retry.success && (!retry.teams || retry.teams.length === 0)) {
      consecutiveMisses += 1;
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
        teamName: seasonTeamName,
      });
      consecutiveMisses = 0;

      try {
        const addResponse = await addLeague(authHeader, {
          leagueId,
          sport: targetSport,
          seasonYear: year,
          leagueName: retry.leagueName,
          teamId: baseTeamId,
          teamName: seasonTeamName,
        }, correlationId);

        if (addResponse.status === 409) {
          await patchLeagueTeam(authHeader, leagueId, {
            teamId: baseTeamId,
            sport: targetSport,
            teamName: seasonTeamName,
            leagueName: retry.leagueName,
            seasonYear: year,
          }, correlationId);
        } else if (addResponse.status === 400) {
          const addData = await addResponse.json().catch(() => ({})) as { code?: string };
          if (addData.code === 'LIMIT_EXCEEDED') {
            limitExceeded = true;
            break;
          }
        }
      } catch {
        // Ignore save errors and continue discovery.
      }

      continue;
    }

    if (retry.httpStatus === 404) {
      consecutiveMisses += 1;
      continue;
    }

    if (retry.httpStatus === 401 || retry.httpStatus === 403) {
      const hasKnownSeason = discovered.length > 0 || existingSeasons.size > 0;
      if (hasKnownSeason) {
        consecutiveMisses += 1;
        continue;
      }
      return { status: 401, body: { error: 'ESPN credentials expired or invalid', code: 'AUTH_FAILED' } };
    }

    return {
      status: 502,
      body: { error: `ESPN API error: ${retry.error}`, code: 'ESPN_ERROR' },
    };
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
      ...(limitExceeded ? { error: 'League limit reached - some seasons may not have been saved' } : {}),
    },
  };
}
