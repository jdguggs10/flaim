/**
 * Chrome Storage Utilities
 * ---------------------------------------------------------------------------
 * Wrapper for chrome.storage.local API to persist setup state.
 */

import type { DiscoveredLeague, EspnHistoryStatus, SeasonCounts } from './api';
export type { SeasonCounts };

// =============================================================================
// SETUP STATE PERSISTENCE
// =============================================================================

const SETUP_STATE_KEY = 'flaim_setup_state';
const ESPN_HISTORY_STATE_KEY_PREFIX = 'flaim_espn_history_state:';

export type SetupStep =
  | 'idle'
  | 'syncing'
  | 'discovering'
  | 'complete'
  | 'error';

export interface SetupState {
  step: SetupStep;
  error?: string;
  discovered?: Pick<DiscoveredLeague, 'sport' | 'leagueName' | 'teamName'>[];
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

function espnHistoryStateKey(userId: string): string {
  return `${ESPN_HISTORY_STATE_KEY_PREFIX}${userId}`;
}

export async function getEspnHistoryState(userId: string | null): Promise<EspnHistoryStatus | null> {
  if (!userId) return null;
  const key = espnHistoryStateKey(userId);
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

export async function setEspnHistoryState(
  userId: string | null,
  history: EspnHistoryStatus | null
): Promise<void> {
  if (!userId) return;
  const key = espnHistoryStateKey(userId);
  if (history) {
    await chrome.storage.local.set({ [key]: history });
  } else {
    await chrome.storage.local.remove(key);
  }
}
