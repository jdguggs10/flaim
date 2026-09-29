import { describe, expect, it } from 'vitest';
import { combineLeagueRefreshNotices, summarizeLeagueRefreshWriteFailures } from '../league-refresh-write-failures';
import { resolveLeagueSyncNotice } from '../league-sync-notice';

describe('summarizeLeagueRefreshWriteFailures', () => {
  it('reports a successful provider with save failures as partial', () => {
    expect(summarizeLeagueRefreshWriteFailures({
      espn: { partial: true, writeFailureCount: 2 },
    })).toBe('ESPN synced partially. 2 league seasons could not be saved. Use Sync all to retry.');
  });

  it('ignores ordinary successful providers', () => {
    expect(summarizeLeagueRefreshWriteFailures({
      espn: { partial: false },
      yahoo: {},
    })).toBeNull();
  });

  it('keeps another provider failure alongside the successful provider write warning', () => {
    const writeFailureNotice = summarizeLeagueRefreshWriteFailures({
      espn: { partial: true, writeFailureCount: 1 },
      yahoo: { partial: false },
    });

    expect(combineLeagueRefreshNotices(
      writeFailureNotice,
      'Yahoo could not be synced: token expired. Use Sync all to retry Yahoo.',
    )).toBe(
      'ESPN synced partially. 1 league season could not be saved. Use Sync all to retry. Yahoo could not be synced: token expired. Use Sync all to retry Yahoo.',
    );
  });

  it('keeps the write warning when the final page notice prioritizes a Yahoo-empty result', () => {
    const writeFailureNotice = summarizeLeagueRefreshWriteFailures({
      espn: { partial: true, writeFailureCount: 1 },
      yahoo: { partial: false },
    });
    const resolvedNotice = resolveLeagueSyncNotice(
      { state: 'succeeded', notice: 'ESPN history is up to date.' },
      'Yahoo is connected, but we did not find any leagues.',
      writeFailureNotice!,
    );

    expect(combineLeagueRefreshNotices(writeFailureNotice, resolvedNotice)).toBe(
      'ESPN synced partially. 1 league season could not be saved. Use Sync all to retry. Yahoo is connected, but we did not find any leagues.',
    );
  });
});
