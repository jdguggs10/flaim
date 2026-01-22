import { describe, expect, it } from 'vitest';
import type { Sport, ToolParams, ExecuteRequest, ExecuteResponse } from '../types';

describe('espn-client types', () => {
  describe('Sport type', () => {
    it('accepts valid sports', () => {
      const sports: Sport[] = ['football', 'baseball', 'basketball', 'hockey'];
      expect(sports).toHaveLength(4);
    });
  });

  describe('ToolParams interface', () => {
    it('accepts valid params with required fields', () => {
      const params: ToolParams = {
        sport: 'football',
        league_id: '12345',
        season_year: 2024,
      };
      expect(params.sport).toBe('football');
      expect(params.league_id).toBe('12345');
      expect(params.season_year).toBe(2024);
    });

    it('accepts optional fields', () => {
      const params: ToolParams = {
        sport: 'baseball',
        league_id: '67890',
        season_year: 2024,
        team_id: '3',
        week: 5,
        position: 'QB',
        count: 10,
      };
      expect(params.team_id).toBe('3');
      expect(params.week).toBe(5);
      expect(params.position).toBe('QB');
      expect(params.count).toBe(10);
    });
  });

  describe('ExecuteRequest interface', () => {
    it('accepts valid request structure', () => {
      const request: ExecuteRequest = {
        tool: 'get_standings',
        params: {
          sport: 'football',
          league_id: '12345',
          season_year: 2024,
        },
        authHeader: 'Bearer token123',
      };
      expect(request.tool).toBe('get_standings');
      expect(request.authHeader).toBe('Bearer token123');
    });
  });

  describe('ExecuteResponse interface', () => {
    it('accepts success response', () => {
      const response: ExecuteResponse = {
        success: true,
        data: { standings: [] },
      };
      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
    });

    it('accepts error response', () => {
      const response: ExecuteResponse = {
        success: false,
        error: 'Something went wrong',
        code: 'INTERNAL_ERROR',
      };
      expect(response.success).toBe(false);
      expect(response.error).toBe('Something went wrong');
      expect(response.code).toBe('INTERNAL_ERROR');
    });
  });
});
