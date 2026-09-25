/**
 * Flaim API Client - Clerk Auth Version
 * ---------------------------------------------------------------------------
 * API client for communicating with Flaim's extension endpoints.
 * All authenticated endpoints accept Clerk JWTs via Authorization header.
 */

// Cache the API base URL after first detection
let cachedApiBase: string | null = null;
let cachedApiBasePromise: Promise<string> | null = null;

const DEFAULT_TIMEOUT_MS = 15_000;
const DISCOVER_TIMEOUT_MS = 60_000;

export class ApiRequestError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly retryAfter: number | null;
  readonly timedOut: boolean;

  constructor(
    message: string,
    options: {
      status?: number | null;
      code?: string | null;
      retryAfter?: number | null;
      timedOut?: boolean;
    } = {}
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.retryAfter = options.retryAfter ?? null;
    this.timedOut = options.timedOut ?? false;
  }
}

function sanitizeStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function sanitizeCode(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,64}$/i.test(value) ? value : null;
}

function sanitizeRetryAfter(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400
    ? Math.floor(value)
    : null;
}

async function toApiRequestError(response: Response, fallback: string): Promise<ApiRequestError> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  return new ApiRequestError(fallback, {
    status: sanitizeStatus(response.status),
    code: sanitizeCode(payload?.error),
    retryAfter: sanitizeRetryAfter(payload?.retry_after),
  });
}

/**
 * Detect API base URL.
 * Priority:
 * 1. VITE_SITE_BASE env var (for preview builds)
 * 2. Chrome extension dev mode detection (unpacked = localhost)
 * 3. Production fallback (flaim.app)
 *
 * Concurrent callers before first resolution share a single in-flight
 * detection promise so chrome.management.getSelf() is only invoked once.
 */
async function detectApiBase(): Promise<string> {
  if (cachedApiBase) return cachedApiBase;
  if (cachedApiBasePromise) return cachedApiBasePromise;

  cachedApiBasePromise = (async () => {
    // 1. Environment variable takes precedence (for preview builds)
    const envBase = import.meta.env.VITE_SITE_BASE as string | undefined;
    if (envBase) {
      return `${envBase}/api/extension`;
    }

    // 2. Fall back to dev mode detection
    try {
      const info = await chrome.management.getSelf();
      const isDevMode = info.installType === 'development';
      return isDevMode
        ? 'http://localhost:3000/api/extension'
        : 'https://flaim.app/api/extension';
    } catch {
      // Fallback to production if detection fails
      return 'https://flaim.app/api/extension';
    }
  })();

  try {
    const resolved = await cachedApiBasePromise;
    cachedApiBase = resolved;
    return resolved;
  } finally {
    cachedApiBasePromise = null;
  }
}

/**
 * Fetch with a timeout via AbortController.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new ApiRequestError('Request timed out', { timedOut: true });
    }
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError('Network request failed', { code: 'network_error' });
  } finally {
    clearTimeout(timeout);
  }
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

/**
 * Sync ESPN credentials to Flaim
 * @param token - Clerk JWT from useAuth().getToken()
 */
export async function syncCredentials(
  token: string,
  credentials: { swid: string; s2: string }
): Promise<SyncResponse> {
  const apiBase = await detectApiBase();
  const response = await fetchWithTimeout(`${apiBase}/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    throw await toApiRequestError(response, 'Unable to save ESPN access');
  }

  return response.json() as Promise<SyncResponse>;
}

/**
 * Check connection status
 * @param token - Clerk JWT from useAuth().getToken()
 */
export async function checkStatus(token: string): Promise<StatusResponse> {
  const apiBase = await detectApiBase();
  const response = await fetchWithTimeout(`${apiBase}/status`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw await toApiRequestError(response, 'Unable to check connection status');
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
  history?: EspnHistoryStatus | null;
}

export interface EspnHistoryStatus {
  jobId: string;
  state: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'superseded' | 'cancelled';
  counts: {
    planned: number;
    completed: number;
    skipped: number;
    failed: number;
  };
  retryable: boolean;
}

function normalizeSeasonCounts(value: unknown): SeasonCounts | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const counts = value as Record<string, unknown>;
  const normalizeCount = (count: unknown) => {
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null;
    return Math.floor(count);
  };
  const found = normalizeCount(counts.found);
  const added = normalizeCount(counts.added);
  const alreadySaved = normalizeCount(counts.alreadySaved);
  if (found === null || added === null || alreadySaved === null) return null;
  return {
    found,
    added,
    alreadySaved,
  };
}

function normalizeDiscoveredLeagues(value: unknown): DiscoveredLeague[] | null {
  if (!Array.isArray(value)) return null;
  const isValid = value.every((league): league is DiscoveredLeague => {
    if (!league || typeof league !== 'object') return false;
    const candidate = league as Record<string, unknown>;
    return (
      typeof candidate.sport === 'string' &&
      typeof candidate.leagueId === 'string' &&
      typeof candidate.leagueName === 'string' &&
      typeof candidate.teamId === 'string' &&
      typeof candidate.teamName === 'string' &&
      typeof candidate.seasonYear === 'number' &&
      Number.isFinite(candidate.seasonYear)
    );
  });
  return isValid ? value : null;
}

function normalizeDiscoverResponse(value: unknown): DiscoverResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiRequestError('Invalid discovery response', { code: 'invalid_response' });
  }
  const response = value as Record<string, unknown>;
  const discovered = normalizeDiscoveredLeagues(response.discovered);
  const currentSeason = normalizeSeasonCounts(response.currentSeason);
  const pastSeasons = normalizeSeasonCounts(response.pastSeasons);
  if (!discovered || !currentSeason || !pastSeasons) {
    throw new ApiRequestError('Invalid discovery response', { code: 'invalid_response' });
  }
  return {
    discovered,
    currentSeason,
    pastSeasons,
    ...(response.history !== undefined ? { history: response.history as EspnHistoryStatus | null } : {}),
  };
}

/**
 * Discover and save all ESPN leagues for the user
 * @param token - Clerk JWT from useAuth().getToken()
 */
export async function discoverLeagues(token: string): Promise<DiscoverResponse> {
  const apiBase = await detectApiBase();
  const response = await fetchWithTimeout(`${apiBase}/discover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  }, DISCOVER_TIMEOUT_MS);

  if (!response.ok) {
    throw await toApiRequestError(response, 'Unable to check ESPN leagues');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiRequestError('Invalid discovery response', { code: 'invalid_response' });
  }
  return normalizeDiscoverResponse(payload);
}

/** Caller-owned status for a durable ESPN history refresh. */
export async function getEspnHistoryStatus(token: string): Promise<EspnHistoryStatus | null> {
  const apiBase = await detectApiBase();
  const response = await fetchWithTimeout(`${apiBase}/history`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw await toApiRequestError(response, 'Unable to check ESPN history status');
  }

  const data = await response.json() as { history?: EspnHistoryStatus | null };
  return data.history ?? null;
}
