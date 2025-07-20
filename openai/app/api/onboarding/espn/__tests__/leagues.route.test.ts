/**
 * Happy-path tests for ESPN leagues API route
 * ---------------------------------------------------------------------------
 * Tests core functionality using supertest
 */

import { NextRequest } from 'next/server';
import { GET, POST } from '../leagues/route';

// Mock Clerk auth
jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn().mockResolvedValue({ userId: 'test_user_123' })
}));

// Mock KV storage
jest.mock('@/auth/espn/kv', () => ({
  getKVStorage: jest.fn().mockReturnValue({
    // Mock storage methods
  })
}));

// Mock KV Storage API
jest.mock('@/auth/espn/kv-storage', () => ({
  EspnKVStorageAPI: jest.fn().mockImplementation(() => ({
    handleSetLeagues: jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    ),
    handleGetLeagues: jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ 
        success: true, 
        leagues: [],
        totalLeagues: 0 
      }), { status: 200 })
    )
  }))
}));

// Mock validateEspnCredentials
jest.mock('@/auth/espn/types', () => ({
  validateEspnCredentials: jest.fn().mockReturnValue({ valid: true, errors: [] })
}));

describe('/api/onboarding/espn/leagues', () => {
  describe('GET', () => {
    it('should return empty leagues for authenticated user', async () => {
      const response = await GET();
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.leagues).toEqual([]);
    });
  });

  describe('POST', () => {
    it('should save leagues successfully with valid data', async () => {
      const testLeagues = [
        {
          leagueId: '12345',
          sport: 'baseball',
          swid: '{12345678-1234-1234-1234-123456789abc}',
          s2: 'AEB123456789abcdef',
          leagueName: 'Test League'
        }
      ];

      const mockRequest = new Request('http://localhost/api/onboarding/espn/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagues: testLeagues })
      });

      const response = await POST(mockRequest as NextRequest);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('ESPN leagues saved successfully');
      expect(data.totalLeagues).toBe(1);
    });

    it('should reject invalid league data', async () => {
      const invalidLeagues = [
        {
          leagueId: '', // Missing required field
          sport: 'baseball',
          swid: 'invalid',
          s2: 'too_short'
        }
      ];

      const mockRequest = new Request('http://localhost/api/onboarding/espn/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagues: invalidLeagues })
      });

      const response = await POST(mockRequest as NextRequest);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('validation errors');
    });

    it('should reject too many leagues', async () => {
      const tooManyLeagues = Array(11).fill({
        leagueId: '12345',
        sport: 'baseball',
        swid: '{12345678-1234-1234-1234-123456789abc}',
        s2: 'AEB123456789abcdef'
      });

      const mockRequest = new Request('http://localhost/api/onboarding/espn/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagues: tooManyLeagues })
      });

      const response = await POST(mockRequest as NextRequest);
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Maximum of 10 leagues allowed per user');
    });
  });
});