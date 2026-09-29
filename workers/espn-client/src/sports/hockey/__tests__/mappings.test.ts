import { describe, expect, it } from 'vitest';

import { transformStats } from '../mappings';

describe('hockey stat mappings', () => {
  it('labels live-verified skater stats and preserves unknown IDs', () => {
    expect(transformStats({
      16: 42,
      25: 810,
      26: 43_200,
      27: 1_200,
      30: 12,
      34: 5,
      999: 7,
    })).toEqual({
      PTS: 42,
      SHFT: 810,
      TOI_SECONDS: 43_200,
      ATOI_SECONDS: 1_200,
      GP: 12,
      STAT_34: 5,
      STAT_999: 7,
    });
  });

  it('labels live-verified goalie stats and handles common games played', () => {
    expect(transformStats({
      8: 3_600,
      12: 0.667,
      30: 4,
      999: 2,
    })).toEqual({
      MIN_SECONDS: 3_600,
      'W%': 0.667,
      GP: 4,
      STAT_999: 2,
    });
  });
});
