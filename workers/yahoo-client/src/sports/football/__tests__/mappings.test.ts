import { describe, expect, it } from 'vitest';
import { getPositionFilter } from '../mappings';

describe('football getPositionFilter', () => {
  it('passes through standard offensive positions', () => {
    expect(getPositionFilter('QB')).toBe('QB');
    expect(getPositionFilter('WR')).toBe('WR');
    expect(getPositionFilter('flex')).toBe('W/R/T');
  });

  it('returns no filter for ALL or an unset position', () => {
    expect(getPositionFilter('ALL')).toBe('');
    expect(getPositionFilter()).toBe('');
  });

  // Regression: IDP leagues' roster fetch surfaces defensive positions (D, LB,
  // DB, ...) via display_position, but free-agent/player search filtering fell
  // through to "no filter" for any position not in FA_POSITION_FILTER,
  // silently returning unfiltered top-owned (offensive) players instead.
  it.each(['D', 'DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'])(
    'passes through IDP position %s instead of silently dropping the filter',
    (position) => {
      expect(getPositionFilter(position)).toBe(position);
      expect(getPositionFilter(position.toLowerCase())).toBe(position);
    }
  );
});
