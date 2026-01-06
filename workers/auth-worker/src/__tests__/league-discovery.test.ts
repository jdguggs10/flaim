import { describe, expect, it } from '@jest/globals';
import {
  discoverLeaguesV3,
  discoverLeaguesV3Safe,
} from '../v3/league-discovery';
import { EspnCredentialsRequired } from '../espn-types';

describe('discoverLeaguesV3', () => {
  it('throws EspnCredentialsRequired when cookies are missing', async () => {
    await expect(discoverLeaguesV3('', '')).rejects.toBeInstanceOf(
      EspnCredentialsRequired
    );
  });

  it('safe wrapper returns a structured error for missing cookies', async () => {
    const result = await discoverLeaguesV3Safe('', '');
    expect(result.success).toBe(false);
    expect(result.leagues).toEqual([]);
    expect(result.error).toMatch(/SWID/i);
  });
});
