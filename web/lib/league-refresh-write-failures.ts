export interface LeagueRefreshWriteFailureResult {
  partial?: boolean;
  writeFailureCount?: number;
}

/**
 * Returns user-facing sync copy only when the auth worker confirmed that a
 * provider completed discovery but could not persist one or more league rows.
 */
export function summarizeLeagueRefreshWriteFailures(
  results: Partial<Record<'espn' | 'yahoo' | 'sleeper', LeagueRefreshWriteFailureResult>> | undefined,
): string | null {
  if (!results) return null;

  const affected = Object.entries(results).filter(([, result]) => result?.partial === true);
  if (affected.length === 0) return null;

  const providerNamesByPlatform: Record<string, string> = {
    espn: 'ESPN',
    yahoo: 'Yahoo',
    sleeper: 'Sleeper',
  };
  const providerNames = affected.map(([platform]) => providerNamesByPlatform[platform] ?? platform);
  const failureCount = affected.reduce((total, [, result]) => total + (result?.writeFailureCount ?? 0), 0);
  const subject = providerNames.join(' and ');
  const countDetail = failureCount > 0
    ? ` ${failureCount} league season${failureCount === 1 ? '' : 's'} could not be saved.`
    : ' Some league seasons could not be saved.';

  return `${subject} synced partially.${countDetail} Use Sync all to retry.`;
}

/** Keep a successful provider's persistence warning alongside another provider's failure guidance. */
export function combineLeagueRefreshNotices(
  writeFailureNotice: string | null,
  providerFailureNotice: string,
): string {
  if (!writeFailureNotice || providerFailureNotice.includes(writeFailureNotice)) return providerFailureNotice;
  return `${writeFailureNotice} ${providerFailureNotice}`;
}
