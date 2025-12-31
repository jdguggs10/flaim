/**
 * Flaim API Client
 * ---------------------------------------------------------------------------
 * API client for communicating with Flaim's extension endpoints.
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

export interface PairResponse {
  success: boolean;
  token: string;
  userId: string;
}

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
 * Exchange a pairing code for an access token
 */
export async function exchangePairingCode(code: string): Promise<PairResponse> {
  const apiBase = await detectApiBase();
  const response = await fetch(`${apiBase}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.toUpperCase().trim() }),
  });

  if (!response.ok) {
    const error = await response.json() as ApiError;
    throw new Error(error.error_description || error.error || 'Invalid pairing code');
  }

  return response.json() as Promise<PairResponse>;
}

/**
 * Sync ESPN credentials to Flaim
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
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const error = await response.json() as ApiError;
    throw new Error(error.error_description || error.error || 'Sync failed');
  }

  return response.json() as Promise<SyncResponse>;
}

/**
 * Check connection status
 */
export async function checkStatus(token: string): Promise<StatusResponse> {
  const apiBase = await detectApiBase();
  const response = await fetch(`${apiBase}/status`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json() as ApiError;
    throw new Error(error.error_description || error.error || 'Status check failed');
  }

  return response.json() as Promise<StatusResponse>;
}
