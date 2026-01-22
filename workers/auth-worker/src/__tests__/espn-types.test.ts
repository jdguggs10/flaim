import { describe, expect, it } from '@jest/globals';
import {
  isValidSport,
  isValidGameId,
  gameIdToSport,
  sportToGameId,
  validateEspnCredentials,
  EspnCredentialsRequired,
  EspnAuthenticationFailed,
  EspnApiError,
  AutomaticLeagueDiscoveryFailed,
  MaxLeaguesExceeded,
  DuplicateLeagueError,
  ESPN_GAME_IDS,
} from '../espn-types';

describe('espn-types', () => {
  // Type guards
  describe('isValidSport', () => {
    it('returns true for valid sports', () => {
      expect(isValidSport('football')).toBe(true);
      expect(isValidSport('baseball')).toBe(true);
      expect(isValidSport('basketball')).toBe(true);
      expect(isValidSport('hockey')).toBe(true);
    });

    it('returns false for invalid sports', () => {
      expect(isValidSport('soccer')).toBe(false);
      expect(isValidSport('FOOTBALL')).toBe(false);
      expect(isValidSport('')).toBe(false);
    });
  });

  describe('isValidGameId', () => {
    it('returns true for valid ESPN game IDs', () => {
      expect(isValidGameId('ffl')).toBe(true);
      expect(isValidGameId('flb')).toBe(true);
      expect(isValidGameId('fba')).toBe(true);
      expect(isValidGameId('fhl')).toBe(true);
    });

    it('returns false for invalid game IDs', () => {
      expect(isValidGameId('football')).toBe(false);
      expect(isValidGameId('FFL')).toBe(false);
      expect(isValidGameId('')).toBe(false);
    });
  });

  // Conversion functions
  describe('gameIdToSport', () => {
    it('converts valid game IDs to sports', () => {
      expect(gameIdToSport('ffl')).toBe('football');
      expect(gameIdToSport('flb')).toBe('baseball');
      expect(gameIdToSport('fba')).toBe('basketball');
      expect(gameIdToSport('fhl')).toBe('hockey');
    });

    it('returns null for invalid game IDs', () => {
      expect(gameIdToSport('invalid')).toBeNull();
      expect(gameIdToSport('')).toBeNull();
    });
  });

  describe('sportToGameId', () => {
    it('converts valid sports to game IDs', () => {
      expect(sportToGameId('football')).toBe('ffl');
      expect(sportToGameId('baseball')).toBe('flb');
      expect(sportToGameId('basketball')).toBe('fba');
      expect(sportToGameId('hockey')).toBe('fhl');
    });

    it('returns null for invalid sports', () => {
      expect(sportToGameId('invalid')).toBeNull();
      expect(sportToGameId('')).toBeNull();
    });
  });

  // Credential validation
  describe('validateEspnCredentials', () => {
    const validSwid = '{BFA3386F-9501-4F4A-88C7-C56D6BB86C11}';
    const validS2 = 'AEBx7jHLKx%2BLJYkzS7QYz%2BTZo4PnxxxxxXXXXxxxxXXXXabcdefghij';

    it('validates correct credentials', () => {
      const result = validateEspnCredentials({ swid: validSwid, s2: validS2 });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects missing SWID', () => {
      const result = validateEspnCredentials({ s2: validS2 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('SWID is required');
    });

    it('rejects missing S2', () => {
      const result = validateEspnCredentials({ swid: validSwid });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('ESPN_S2 cookie is required');
    });

    it('rejects invalid SWID format', () => {
      const result = validateEspnCredentials({ swid: 'invalid-swid', s2: validS2 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('UUID format'))).toBe(true);
    });

    it('rejects short S2 token', () => {
      const result = validateEspnCredentials({ swid: validSwid, s2: 'short' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('too short'))).toBe(true);
    });
  });

  // Error classes
  describe('error classes', () => {
    it('EspnCredentialsRequired has correct name and default message', () => {
      const error = new EspnCredentialsRequired();
      expect(error.name).toBe('EspnCredentialsRequired');
      expect(error.message).toBe('ESPN credentials required for league discovery');
    });

    it('EspnCredentialsRequired accepts custom message', () => {
      const error = new EspnCredentialsRequired('Custom message');
      expect(error.message).toBe('Custom message');
    });

    it('EspnAuthenticationFailed has correct name', () => {
      const error = new EspnAuthenticationFailed();
      expect(error.name).toBe('EspnAuthenticationFailed');
    });

    it('EspnApiError has correct name', () => {
      const error = new EspnApiError('API failed');
      expect(error.name).toBe('EspnApiError');
      expect(error.message).toBe('API failed');
    });

    it('AutomaticLeagueDiscoveryFailed includes status code', () => {
      const error = new AutomaticLeagueDiscoveryFailed('No leagues found', 404);
      expect(error.name).toBe('AutomaticLeagueDiscoveryFailed');
      expect(error.statusCode).toBe(404);
    });

    it('MaxLeaguesExceeded shows correct limit', () => {
      const error = new MaxLeaguesExceeded(10);
      expect(error.name).toBe('MaxLeaguesExceeded');
      expect(error.message).toContain('10');
    });

    it('DuplicateLeagueError includes league details', () => {
      const error = new DuplicateLeagueError('12345', 'football');
      expect(error.name).toBe('DuplicateLeagueError');
      expect(error.message).toContain('12345');
      expect(error.message).toContain('football');
    });
  });

  // Constants
  describe('ESPN_GAME_IDS constant', () => {
    it('maps all four sports correctly', () => {
      expect(ESPN_GAME_IDS.ffl).toBe('football');
      expect(ESPN_GAME_IDS.flb).toBe('baseball');
      expect(ESPN_GAME_IDS.fba).toBe('basketball');
      expect(ESPN_GAME_IDS.fhl).toBe('hockey');
    });

    it('has exactly four entries', () => {
      expect(Object.keys(ESPN_GAME_IDS)).toHaveLength(4);
    });
  });
});
