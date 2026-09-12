export const ESPN_MODERN_LEAGUE_FIRST_YEAR = 2018;

export type EspnLeagueRoute = 'modern' | 'history';

export interface EspnLeagueRequest {
  espnSeasonYear: number;
  leagueId: string;
  query?: string;
  historical: boolean;
  modernPath?: string;
}

type EspnLeaguePathFetcher = (path: string) => Promise<Response>;

function normalizeQuery(query?: string): string {
  return query?.replace(/^[?&]/, '') ?? '';
}

export function buildEspnLeaguePath(
  request: Pick<EspnLeagueRequest, 'espnSeasonYear' | 'leagueId' | 'query'>,
  route: EspnLeagueRoute,
): string {
  const leagueId = encodeURIComponent(request.leagueId);
  const query = normalizeQuery(request.query);

  if (route === 'history') {
    const suffix = query ? `&${query}` : '';
    return `/leagueHistory/${leagueId}?seasonId=${request.espnSeasonYear}${suffix}`;
  }

  const suffix = query ? `?${query}` : '';
  return `/seasons/${request.espnSeasonYear}/segments/0/leagues/${leagueId}${suffix}`;
}

/**
 * Fetch one ESPN league season using the route ESPN expects for that year.
 *
 * ESPN stores pre-2018 leagues under `leagueHistory`. For later historical
 * seasons, ESPN can return 401 from the modern route even when the user's
 * credentials are valid, so retry that specific failure through the history
 * route before allowing the caller to classify it as authentication failure.
 */
export async function fetchEspnLeagueSeason(
  request: EspnLeagueRequest,
  fetchPath: EspnLeaguePathFetcher,
): Promise<Response> {
  if (request.espnSeasonYear < ESPN_MODERN_LEAGUE_FIRST_YEAR) {
    return fetchPath(buildEspnLeaguePath(request, 'history'));
  }

  const modernPath = request.modernPath ?? buildEspnLeaguePath(request, 'modern');
  const response = await fetchPath(modernPath);
  if (!request.historical || response.status !== 401) {
    return response;
  }

  await response.body?.cancel();
  return fetchPath(buildEspnLeaguePath(request, 'history'));
}

/** ESPN's `leagueHistory` route wraps the league object in a one-item array. */
export function unwrapEspnLeaguePayload(payload: unknown): unknown {
  if (!Array.isArray(payload)) {
    return payload;
  }

  return payload[0] ?? null;
}
