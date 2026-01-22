import { describe, expect, it } from 'vitest';
import type { Platform, Sport, ToolParams } from '../types';

describe('fantasy-mcp types', () => {
  describe('Platform type', () => {
    it('accepts valid platforms', () => {
      const platforms: Platform[] = ['espn', 'yahoo'];
      expect(platforms).toHaveLength(2);
    });
  });

  describe('Sport type', () => {
    it('accepts valid sports', () => {
      const sports: Sport[] = ['football', 'baseball', 'basketball', 'hockey'];
      expect(sports).toHaveLength(4);
    });
  });

  describe('ToolParams interface', () => {
    it('accepts valid params with required fields', () => {
      const params: ToolParams = {
        platform: 'espn',
        sport: 'football',
        league_id: '12345',
        season_year: 2024,
      };
      expect(params.platform).toBe('espn');
      expect(params.sport).toBe('football');
      expect(params.league_id).toBe('12345');
      expect(params.season_year).toBe(2024);
    });

    it('accepts optional fields', () => {
      const params: ToolParams = {
        platform: 'yahoo',
        sport: 'baseball',
        league_id: '67890',
        season_year: 2024,
        team_id: '3',
        week: 5,
        position: 'SP',
        count: 25,
      };
      expect(params.team_id).toBe('3');
      expect(params.week).toBe(5);
      expect(params.position).toBe('SP');
      expect(params.count).toBe(25);
    });
  });
});
