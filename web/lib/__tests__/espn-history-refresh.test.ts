import { describe, expect, it } from 'vitest';
import { shouldProbeEspnHistoryAfterRefreshFailure } from '../espn-history-refresh';

describe('shouldProbeEspnHistoryAfterRefreshFailure', () => {
  it('probes after ambiguous network failures and proxy timeouts', () => {
    expect(shouldProbeEspnHistoryAfterRefreshFailure(false)).toBe(true);
    expect(shouldProbeEspnHistoryAfterRefreshFailure(true, 'refresh_timeout')).toBe(true);
  });

  it('keeps explicit HTTP failures visible even when older history is active', () => {
    expect(shouldProbeEspnHistoryAfterRefreshFailure(true, 'rate_limit_exceeded')).toBe(false);
    expect(shouldProbeEspnHistoryAfterRefreshFailure(true, 'refresh_cooldown')).toBe(false);
    expect(shouldProbeEspnHistoryAfterRefreshFailure(true)).toBe(false);
  });
});
