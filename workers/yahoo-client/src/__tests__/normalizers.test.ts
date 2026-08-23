import { describe, it, expect } from 'vitest';
import { asArray, getPath, toYahooBoolean, toYahooFiniteNumber, unwrapLeague, unwrapTeam } from '../shared/normalizers';

describe('normalizers', () => {
  describe('asArray', () => {
    it('converts numeric-keyed object to array', () => {
      const input = { '0': { id: 'a' }, '1': { id: 'b' }, 'count': 2 };
      const result = asArray(input);
      expect(result).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('returns empty array for null/undefined', () => {
      expect(asArray(null)).toEqual([]);
      expect(asArray(undefined)).toEqual([]);
    });

    it('returns array unchanged', () => {
      const input = [{ id: 'a' }, { id: 'b' }];
      expect(asArray(input)).toEqual(input);
    });

    it('skips non-numeric keys', () => {
      const input = { '0': 'first', 'meta': 'skip', '1': 'second' };
      expect(asArray(input)).toEqual(['first', 'second']);
    });

    it('handles sparse numeric keys', () => {
      const input = { '0': 'zero', '2': 'two', '5': 'five' };
      expect(asArray(input)).toEqual(['zero', 'two', 'five']);
    });

    it('handles empty object', () => {
      expect(asArray({})).toEqual([]);
    });
  });

  describe('getPath', () => {
    it('traverses nested objects', () => {
      const obj = { a: { b: { c: 'value' } } };
      expect(getPath(obj, ['a', 'b', 'c'])).toBe('value');
    });

    it('traverses arrays by index', () => {
      const obj = { items: [{ name: 'first' }, { name: 'second' }] };
      expect(getPath(obj, ['items', 1, 'name'])).toBe('second');
    });

    it('returns undefined for missing path', () => {
      const obj = { a: { b: 1 } };
      expect(getPath(obj, ['a', 'c', 'd'])).toBeUndefined();
    });

    it('returns undefined for null in path', () => {
      const obj = { a: null };
      expect(getPath(obj, ['a', 'b'])).toBeUndefined();
    });

    it('returns the value at root level', () => {
      const obj = { key: 'value' };
      expect(getPath(obj, ['key'])).toBe('value');
    });

    it('returns entire object for empty path', () => {
      const obj = { a: 1 };
      expect(getPath(obj, [])).toEqual({ a: 1 });
    });

    it('handles mixed object and array traversal', () => {
      const obj = {
        fantasy_content: {
          league: [{ name: 'My League' }, { standings: [] }],
        },
      };
      expect(getPath(obj, ['fantasy_content', 'league', 0, 'name'])).toBe('My League');
    });

    it('returns undefined when traversing primitive', () => {
      const obj = { a: 'string' };
      expect(getPath(obj, ['a', 'b'])).toBeUndefined();
    });
  });

  describe('unwrapLeague', () => {
    it('merges metadata and nested resources', () => {
      const input = [
        { league_key: '449.l.123', name: 'My League' },
        { standings: [{ teams: {} }] },
      ];
      const result = unwrapLeague(input);
      expect(result.league_key).toBe('449.l.123');
      expect(result.name).toBe('My League');
      expect(result.standings).toEqual([{ teams: {} }]);
    });

    it('handles empty array', () => {
      expect(unwrapLeague([])).toEqual({});
    });

    it('handles non-array input', () => {
      expect(unwrapLeague('not an array')).toEqual({});
    });

    it('handles null input', () => {
      expect(unwrapLeague(null)).toEqual({});
    });

    it('handles array with only metadata', () => {
      const input = [{ league_key: '449.l.123', name: 'My League' }];
      const result = unwrapLeague(input);
      expect(result.league_key).toBe('449.l.123');
      expect(result.name).toBe('My League');
    });

    it('handles nested resources overwriting metadata', () => {
      const input = [{ key: 'original' }, { key: 'overwritten' }];
      const result = unwrapLeague(input);
      expect(result.key).toBe('overwritten');
    });
  });

  describe('unwrapTeam', () => {
    it('extracts team metadata from nested arrays', () => {
      const input = [
        [{ team_key: '449.l.123.t.1' }, { name: 'Team Name' }],
        { team_standings: { rank: 1 } },
      ];
      const result = unwrapTeam(input);
      expect(result.team_key).toBe('449.l.123.t.1');
      expect(result.name).toBe('Team Name');
      expect(result.team_standings).toEqual({ rank: 1 });
    });

    it('handles empty array', () => {
      expect(unwrapTeam([])).toEqual({});
    });

    it('handles non-array input', () => {
      expect(unwrapTeam('not an array')).toEqual({});
    });

    it('handles null input', () => {
      expect(unwrapTeam(null)).toEqual({});
    });

    it('handles array with non-array first element', () => {
      const input = [{ team_key: '449.l.123.t.1' }];
      const result = unwrapTeam(input);
      expect(result).toEqual({});
    });

    it('handles metadata array with primitive values', () => {
      const input = [[{ team_key: '449.l.123.t.1' }, 'primitive', null, { name: 'Team' }]];
      const result = unwrapTeam(input);
      expect(result.team_key).toBe('449.l.123.t.1');
      expect(result.name).toBe('Team');
    });

    it('merges multiple nested resources', () => {
      const input = [
        [{ team_key: '449.l.123.t.1' }],
        { roster: { players: [] } },
        { matchups: [{ week: 1 }] },
      ];
      const result = unwrapTeam(input);
      expect(result.team_key).toBe('449.l.123.t.1');
      expect(result.roster).toEqual({ players: [] });
      expect(result.matchups).toEqual([{ week: 1 }]);
    });
  });

  describe('toYahooBoolean (FLA-284)', () => {
    it('passes through native booleans', () => {
      expect(toYahooBoolean(true)).toBe(true);
      expect(toYahooBoolean(false)).toBe(false);
    });

    it('normalizes "0"/"1" strings (real /settings fixture shape)', () => {
      expect(toYahooBoolean('1')).toBe(true);
      expect(toYahooBoolean('0')).toBe(false);
    });

    it('normalizes 0/1 numbers (e.g. is_finished elsewhere in this codebase)', () => {
      expect(toYahooBoolean(1)).toBe(true);
      expect(toYahooBoolean(0)).toBe(false);
    });

    it('returns undefined for unrecognized values rather than guessing', () => {
      expect(toYahooBoolean(undefined)).toBeUndefined();
      expect(toYahooBoolean(null)).toBeUndefined();
      expect(toYahooBoolean('yes')).toBeUndefined();
      expect(toYahooBoolean(2)).toBeUndefined();
    });

    it('normalizes "true"/"false" strings, case-insensitive and trimmed (FLA-284)', () => {
      expect(toYahooBoolean('true')).toBe(true);
      expect(toYahooBoolean('false')).toBe(false);
      expect(toYahooBoolean('TRUE')).toBe(true);
      expect(toYahooBoolean('False')).toBe(false);
      expect(toYahooBoolean('  true  ')).toBe(true);
    });

    it('does not coerce other unrecognized strings/empty string/null to true (FLA-284 audit)', () => {
      expect(toYahooBoolean('yes')).toBeUndefined();
      expect(toYahooBoolean('')).toBeUndefined();
      expect(toYahooBoolean(null)).toBeUndefined();
    });
  });

  describe('toYahooFiniteNumber (FLA-284)', () => {
    it('passes through finite numbers', () => {
      expect(toYahooFiniteNumber(1)).toBe(1);
      expect(toYahooFiniteNumber(0)).toBe(0);
    });

    it('parses numeric strings (real /settings fixture: trade_reject_time "1")', () => {
      expect(toYahooFiniteNumber('1')).toBe(1);
      expect(toYahooFiniteNumber('42')).toBe(42);
    });

    it('returns undefined for missing/non-finite/non-numeric values', () => {
      expect(toYahooFiniteNumber(undefined)).toBeUndefined();
      expect(toYahooFiniteNumber(null)).toBeUndefined();
      expect(toYahooFiniteNumber('N/A')).toBeUndefined();
      expect(toYahooFiniteNumber(Number.NaN)).toBeUndefined();
    });
  });
});
