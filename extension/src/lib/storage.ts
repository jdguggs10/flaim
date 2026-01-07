/**
 * Chrome Storage Utilities
 * ---------------------------------------------------------------------------
 * Wrapper for chrome.storage.local API to persist extension token.
 */

const TOKEN_KEY = 'flaim_extension_token';

/**
 * Get stored extension token
 */
export async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  return result[TOKEN_KEY] || null;
}

/**
 * Store extension token
 */
export async function setToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

/**
 * Clear stored extension token
 */
export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}

/**
 * Check if extension is paired (has stored token)
 */
export async function isPaired(): Promise<boolean> {
  const token = await getToken();
  return token !== null;
}

// =============================================================================
// SETUP STATE PERSISTENCE (v1.1)
// =============================================================================

const SETUP_STATE_KEY = 'flaim_setup_state';

export interface LeagueOption {
  sport: string;
  leagueId: string;
  leagueName: string;
  teamId: string;
  teamName: string;
  seasonYear: number;
  isDefault: boolean;
}

export type SetupStep =
  | 'idle'
  | 'syncing'
  | 'discovering'
  | 'selecting_default'
  | 'complete'
  | 'error';

export interface SetupState {
  step: SetupStep;
  error?: string;
  discovered?: Array<{
    sport: string;
    leagueName: string;
    teamName: string;
  }>;
  currentSeasonLeagues?: LeagueOption[];
  added?: number;
  skipped?: number;
  historical?: number;
}

/**
 * Get stored setup state
 */
export async function getSetupState(): Promise<SetupState | null> {
  const result = await chrome.storage.local.get(SETUP_STATE_KEY);
  return result[SETUP_STATE_KEY] || null;
}

/**
 * Store setup state
 */
export async function setSetupState(state: SetupState): Promise<void> {
  await chrome.storage.local.set({ [SETUP_STATE_KEY]: state });
}

/**
 * Clear setup state
 */
export async function clearSetupState(): Promise<void> {
  await chrome.storage.local.remove(SETUP_STATE_KEY);
}
