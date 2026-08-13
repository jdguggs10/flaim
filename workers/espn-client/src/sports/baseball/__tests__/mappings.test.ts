import { describe, expect, it } from 'vitest';

import { getInjuryStatus } from '../mappings';

describe('baseball injury status mappings', () => {
  it.each([
    ['SEVEN_DAY_DL', '7-day injured list'],
    ['TEN_DAY_DL', '10-day injured list'],
    ['FIFTEEN_DAY_DL', '15-day injured list'],
    ['SIXTY_DAY_DL', '60-day injured list'],
  ])('translates ESPN %s without exposing the provider enum', (status, expected) => {
    expect(getInjuryStatus(status)).toBe(expected);
  });

  it('preserves an unknown status for forward compatibility', () => {
    expect(getInjuryStatus('FUTURE_ESPN_STATUS')).toBe('FUTURE_ESPN_STATUS');
  });
});
