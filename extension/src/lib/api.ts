/**
 * Flaim API Client - Clerk Auth Version
 * ---------------------------------------------------------------------------
 * API client for communicating with Flaim's extension endpoints.
 * All authenticated endpoints accept Clerk JWTs via Authorization header.
 */

// Cache the API base URL after first detection
let cachedApiBase: string | null = null;

/**
 * Detect API base URL.
 * Priority:
 * 1. VITE_SITE_BASE env var (for preview builds)
 * 2. Chrome extension dev mode detection (unpacked = localhost)
 * 3. Production fallback (flaim.app)
 */
async function detectApiBase(): Promise<string> {
  if (cachedApiBase) return cachedApiBase;

  // 1. Environment variable takes precedence (for preview builds)
  const envBase = import.meta.env.VITE_SITE_BASE as string | undefined;
  if (envBase) {
    cachedApiBase = `${envBase}/api/extension`;
    return cachedApiBase;
  }

  // 2. Fall back to dev mode detection
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
    console.warn('[Flaim] sync failed:', response.status, error.error);
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
    console.warn('[Flaim] status check failed:', response.status, error.error);
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
  currentSeason: SeasonCounts;
  pastSeasons: SeasonCounts;
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
    console.warn('[Flaim] discover failed:', response.status, error.error);
    throw new Error(error.error_description || error.error || 'Discovery failed');
  }

  return response.json() as Promise<DiscoverResponse>;
}
