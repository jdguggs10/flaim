/**
 * Chrome Storage Utilities
 * ---------------------------------------------------------------------------
 * Wrapper for chrome.storage.local API to persist setup state.
 */

// =============================================================================
// SETUP STATE PERSISTENCE
// =============================================================================

const SETUP_STATE_KEY = 'flaim_setup_state';

export type SetupStep =
  | 'idle'
  | 'syncing'
  | 'discovering'
  | 'complete'
  | 'error';

/**
 * Season counts for granular messaging
 */
export interface SeasonCounts {
  found: number;
  added: number;
  alreadySaved: number;
}

export interface SetupState {
  step: SetupStep;
  error?: string;
  discovered?: Array<{
    sport: string;
    leagueName: string;
    teamName: string;
  }>;
  // Structured counts
  currentSeason?: SeasonCounts;
  pastSeasons?: SeasonCounts;
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
