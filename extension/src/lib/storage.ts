/**
 * Chrome Storage Utilities
 * ---------------------------------------------------------------------------
 * Wrapper for chrome.storage.local API to persist account-scoped popup state.
 */

import type { EspnHistoryStatus, SeasonCounts } from './api';
export type { SeasonCounts };

const ESPN_HISTORY_STATE_KEY_PREFIX = 'flaim_espn_history_state:';
const REVIEW_INVITATION_STATE_KEY_PREFIX = 'flaim_review_invitation_state:';

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

export interface ReviewInvitationState {
  shown: boolean;
  dismissed: boolean;
}

function reviewInvitationStateKey(userId: string): string {
  return `${REVIEW_INVITATION_STATE_KEY_PREFIX}${userId}`;
}

export async function getReviewInvitationState(userId: string | null): Promise<ReviewInvitationState | null> {
  if (!userId) return null;
  const key = reviewInvitationStateKey(userId);
  const result = await chrome.storage.local.get(key);
  const state = result[key];
  if (!state || typeof state !== 'object') return null;
  const candidate = state as Partial<ReviewInvitationState>;
  return {
    shown: candidate.shown === true,
    dismissed: candidate.dismissed === true,
  };
}

export async function setReviewInvitationState(
  userId: string | null,
  state: ReviewInvitationState
): Promise<void> {
  if (!userId) return;
  await chrome.storage.local.set({ [reviewInvitationStateKey(userId)]: state });
}
