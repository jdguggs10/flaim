/**
 * Chrome Storage Utilities
 * ---------------------------------------------------------------------------
 * Wrapper for chrome.storage.local API to persist setup state.
 */

// =============================================================================
// SETUP STATE PERSISTENCE (v1.1.1)
// =============================================================================

const SETUP_STATE_KEY = 'flaim_setup_state';
const DEFAULT_LEAGUE_KEY = 'flaim_default_league';

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
  currentSeasonLeagues?: LeagueOption[];
  // New structured counts (v1.1.1)
  currentSeason?: SeasonCounts;
  pastSeasons?: SeasonCounts;
  // Legacy fields (for migration from v1.1)
  added?: number;
  skipped?: number;
  historical?: number;
}

export interface SavedDefaultLeague {
  sport: string;
  leagueId: string;
  leagueName: string;
  teamName: string;
  seasonYear: number;
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

export async function getSavedDefaultLeague(): Promise<SavedDefaultLeague | null> {
  const result = await chrome.storage.local.get(DEFAULT_LEAGUE_KEY);
  return result[DEFAULT_LEAGUE_KEY] || null;
}

export async function setSavedDefaultLeague(
  league: SavedDefaultLeague
): Promise<void> {
  await chrome.storage.local.set({ [DEFAULT_LEAGUE_KEY]: league });
}
