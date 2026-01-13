/**
 * Flaim API Client - Clerk Auth Version
 * ---------------------------------------------------------------------------
 * API client for communicating with Flaim's extension endpoints.
 * All authenticated endpoints accept Clerk JWTs via Authorization header.
 */

// Cache the API base URL after first detection
let cachedApiBase: string | null = null;

/**
 * Detect if running in development mode using the official Chrome API.
 * Uses chrome.management.getSelf() which returns installType: "development"
 * for unpacked extensions. No permissions required.
 */
async function detectApiBase(): Promise<string> {
  if (cachedApiBase) return cachedApiBase;

  try {
    const info = await chrome.management.getSelf();
    const isDevMode = info.installType === 'development';
    cachedApiBase = isDevMode
      ? 'http://localhost:3000/api/extension'
      : 'https://flaim.app/api/extension';
  } catch {
    // Fallback to production if detection fails
    cachedApiBase = 'https://flaim.app/api/extension';
  }

  return cachedApiBase;
}

/**
 * Get the base URL for the Flaim site (not API).
 * Exported for use in Popup.tsx for opening tabs.
 */
export async function getSiteBase(): Promise<string> {
  const apiBase = await detectApiBase();
  return apiBase.replace('/api/extension', '');
}

// =============================================================================
// ACTIVE API (uses Clerk JWT tokens)
// =============================================================================

export interface SyncResponse {
  success: boolean;
  message: string;
}

export interface StatusResponse {
  success: boolean;
  connected: boolean;
  hasCredentials: boolean;
  lastSync: string | null;
  defaultLeague?: {
    sport: string;
    leagueId: string;
    leagueName: string | null;
    teamName: string | null;
    teamId: string | null;
    seasonYear: number | null;
  } | null;
}

export interface ApiError {
  error: string;
  error_description?: string;
}

/**
 * Sync ESPN credentials to Flaim
 * @param token - Clerk JWT from useAuth().getToken()
 */
export async function syncCredentials(
  token: string,
  credentials: { swid: string; s2: string }
): Promise<SyncResponse> {
  const apiBase = await detectApiBase();
  const response = await fetch(`${apiBase}/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const error = (await response.json()) as ApiError;
    throw new Error(error.error_description || error.error || 'Sync failed');
  }

  return response.json() as Promise<SyncResponse>;
}

/**
 * Check connection status
 * @param token - Clerk JWT from useAuth().getToken()
 */
export async function checkStatus(token: string): Promise<StatusResponse> {
  const apiBase = await detectApiBase();
  const response = await fetch(`${apiBase}/status`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = (await response.json()) as ApiError;
    throw new Error(error.error_description || error.error || 'Status check failed');
  }

  return response.json() as Promise<StatusResponse>;
}

// =============================================================================
// LEAGUE DISCOVERY API
// =============================================================================

export interface DiscoveredLeague {
  sport: string;
  leagueId: string;
  leagueName: string;
  teamId: string;
  teamName: string;
  seasonYear: number;
}

export interface CurrentSeasonLeague extends DiscoveredLeague {
  isDefault: boolean;
}

/**
 * Season counts for granular messaging
 */
export interface SeasonCounts {
  found: number;
  added: number;
  alreadySaved: number;
}

export interface DiscoverResponse {
  discovered: DiscoveredLeague[];
  currentSeasonLeagues: CurrentSeasonLeague[];
  currentSeason: SeasonCounts;
  pastSeasons: SeasonCounts;
  // Legacy fields (deprecated, kept for backwards compatibility)
  added: number;
  skipped: number;
  historical: number;
}

/**
 * Discover and save all ESPN leagues for the user
 * @param token - Clerk JWT from useAuth().getToken()
 */
export async function discoverLeagues(token: string): Promise<DiscoverResponse> {
  const apiBase = await detectApiBase();
  const response = await fetch(`${apiBase}/discover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = (await response.json()) as ApiError;
    throw new Error(error.error_description || error.error || 'Discovery failed');
  }

  return response.json() as Promise<DiscoverResponse>;
}

export interface SetDefaultRequest {
  leagueId: string;
  sport: string;
  seasonYear: number;
}

/**
 * Set a league as the user's default
 * @param token - Clerk JWT from useAuth().getToken()
 */
export async function setDefaultLeague(token: string, league: SetDefaultRequest): Promise<void> {
  const apiBase = await detectApiBase();
  const response = await fetch(`${apiBase}/set-default`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(league),
  });

  if (!response.ok) {
    const error = (await response.json()) as ApiError;
    throw new Error(error.error_description || error.error || 'Failed to set default');
  }
}
