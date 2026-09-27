// Resolves which single notice /leagues shows after a "Sync all" refresh,
// when both an ESPN durable-history status and a Yahoo empty-sync notice
// could apply. `partial` and `failed` are ESPN history's own failure states
// (see EspnHistoryStatus in web/app/(site)/leagues/page.tsx); every other
// state (queued/running/succeeded/superseded/cancelled) is informational or
// a plain success. An ESPN failure notice must stay visible -- silently
// swapping it for the Yahoo-empty notice would hide a real ESPN problem --
// but an informational or success ESPN notice can lose to a Yahoo-empty
// notice, since "you have no Yahoo leagues on this login" is more actionable
// than "ESPN history is up to date."
export function isEspnHistoryFailureState(state: string): boolean {
  return state === 'failed' || state === 'partial';
}

export interface EspnHistoryNoticeInfo {
  state: string;
  notice: string;
}

/**
 * @param espnHistory - the ESPN history notice actually shown, paired with the
 *   state it was derived from, or null/undefined when no history entry came
 *   back on this refresh.
 * @param yahooEmptyNotice - the Yahoo empty-sync notice, or null when Yahoo
 *   did not come back empty on this refresh.
 * @param fallbackNotice - the generic refresh summary to fall back to when
 *   neither an ESPN history notice nor a Yahoo empty-sync notice applies.
 */
export function resolveLeagueSyncNotice(
  espnHistory: EspnHistoryNoticeInfo | null | undefined,
  yahooEmptyNotice: string | null,
  fallbackNotice: string
): string {
  if (!espnHistory) {
    return yahooEmptyNotice ?? fallbackNotice;
  }

  if (isEspnHistoryFailureState(espnHistory.state)) {
    return yahooEmptyNotice ? `${espnHistory.notice} ${yahooEmptyNotice}` : espnHistory.notice;
  }

  return yahooEmptyNotice ?? espnHistory.notice;
}
