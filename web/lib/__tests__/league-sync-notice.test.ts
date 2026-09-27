import { describe, expect, it } from 'vitest';
import { isEspnHistoryFailureState, resolveLeagueSyncNotice } from '../league-sync-notice';

describe('isEspnHistoryFailureState', () => {
  it('treats only failed and partial as ESPN history failures', () => {
    expect(isEspnHistoryFailureState('failed')).toBe(true);
    expect(isEspnHistoryFailureState('partial')).toBe(true);
    expect(isEspnHistoryFailureState('succeeded')).toBe(false);
    expect(isEspnHistoryFailureState('queued')).toBe(false);
    expect(isEspnHistoryFailureState('running')).toBe(false);
    expect(isEspnHistoryFailureState('superseded')).toBe(false);
    expect(isEspnHistoryFailureState('cancelled')).toBe(false);
  });
});

describe('resolveLeagueSyncNotice', () => {
  const fallback = 'Synced connected platforms.';

  it('combines the ESPN failure notice with a Yahoo empty-sync notice instead of hiding either', () => {
    expect(
      resolveLeagueSyncNotice(
        { state: 'failed', notice: 'ESPN history could not be indexed. Use Sync all later to retry it.' },
        'Yahoo is connected, but we didn\'t find any leagues on this Yahoo login. If your league is on a different Yahoo account, reconnect with that one.',
        fallback
      )
    ).toBe(
      "ESPN history could not be indexed. Use Sync all later to retry it. Yahoo is connected, but we didn't find any leagues on this Yahoo login. If your league is on a different Yahoo account, reconnect with that one."
    );

    expect(
      resolveLeagueSyncNotice(
        { state: 'partial', notice: 'Some ESPN history could not be indexed. Use Sync all later to retry it.' },
        'Yahoo empty notice',
        fallback
      )
    ).toBe('Some ESPN history could not be indexed. Use Sync all later to retry it. Yahoo empty notice');
  });

  it('keeps the ESPN failure notice alone when Yahoo did not come back empty', () => {
    expect(
      resolveLeagueSyncNotice(
        { state: 'failed', notice: 'ESPN history could not be indexed. Use Sync all later to retry it.' },
        null,
        fallback
      )
    ).toBe('ESPN history could not be indexed. Use Sync all later to retry it.');
  });

  it('lets the Yahoo empty-sync notice win over an informational or successful ESPN history notice', () => {
    expect(
      resolveLeagueSyncNotice(
        { state: 'succeeded', notice: 'ESPN history is up to date.' },
        'Yahoo empty notice',
        fallback
      )
    ).toBe('Yahoo empty notice');

    expect(
      resolveLeagueSyncNotice(
        { state: 'running', notice: 'Current leagues are synced. ESPN history is continuing in the background.' },
        'Yahoo empty notice',
        fallback
      )
    ).toBe('Yahoo empty notice');

    expect(
      resolveLeagueSyncNotice(
        { state: 'superseded', notice: 'ESPN history refresh stopped after your connection changed. Use Sync all to start again.' },
        'Yahoo empty notice',
        fallback
      )
    ).toBe('Yahoo empty notice');
  });

  it('falls back to the ESPN notice when it is informational/success and Yahoo has nothing to say', () => {
    expect(
      resolveLeagueSyncNotice({ state: 'succeeded', notice: 'ESPN history is up to date.' }, null, fallback)
    ).toBe('ESPN history is up to date.');
  });

  it('falls back to the Yahoo empty-sync notice, then the generic summary, when there is no ESPN history at all', () => {
    expect(resolveLeagueSyncNotice(null, 'Yahoo empty notice', fallback)).toBe('Yahoo empty notice');
    expect(resolveLeagueSyncNotice(undefined, null, fallback)).toBe(fallback);
  });
});
