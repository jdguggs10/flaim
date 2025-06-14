/**
 * Smoke tests for core auth middleware functionality
 * Tests the platform-agnostic authentication logic
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { 
  verifySession, 
  requireSession, 
  requireSessionWithUsage,
  setSessionVerifier,
  createErrorResponse,
  createUsageLimitResponse,
  extractToken
} from '../auth-middleware.js';
import { UsageTracker } from '../usage-tracker.js';
import type { AuthSession, SessionVerifier } from '../interfaces.js';

// Mock session verifier for testing
class MockSessionVerifier implements SessionVerifier {
  private mockUserId: string | null = null;

  setMockUser(userId: string | null) {
    this.mockUserId = userId;
  }

  async verifySession(token?: string): Promise<AuthSession | null> {
    if (!this.mockUserId) {
      return null;
    }

    return {
      userId: this.mockUserId,
      isAuthenticated: true
    };
  }
}

describe('Auth Middleware', () => {
  let mockVerifier: MockSessionVerifier;

  beforeEach(() => {
    mockVerifier = new MockSessionVerifier();
    setSessionVerifier(mockVerifier);
    
    // Clear usage tracker between tests
    UsageTracker.clearUsage('test-user');
  });

  describe('verifySession', () => {
    it('should return session for valid user', async () => {
      mockVerifier.setMockUser('test-user');
      
      const session = await verifySession();
      
      expect(session).toEqual({
        userId: 'test-user',
        isAuthenticated: true
      });
    });

    it('should return null for invalid user', async () => {
      mockVerifier.setMockUser(null);
      
      const session = await verifySession();
      
      expect(session).toBeNull();
    });
  });

  describe('requireSession', () => {
    it('should return user data for authenticated user', async () => {
      mockVerifier.setMockUser('test-user');
      
      const result = await requireSession();
      
      expect(result).toEqual({ userId: 'test-user' });
    });

    it('should return error response for unauthenticated user', async () => {
      mockVerifier.setMockUser(null);
      
      const result = await requireSession();
      
      expect(result).toBeInstanceOf(Response);
      
      if (result instanceof Response) {
        expect(result.status).toBe(401);
        const json = await result.json();
        expect(json.error).toBe('Authentication required');
      }
    });
  });

  describe('requireSessionWithUsage', () => {
    it('should allow usage for user within limits', async () => {
      mockVerifier.setMockUser('test-user');
      
      const result = await requireSessionWithUsage();
      
      expect(result).not.toBeInstanceOf(Response);
      
      if (!(result instanceof Response)) {
        expect(result.userId).toBe('test-user');
        expect(result.canProceed).toBe(true);
        expect(result.usage.allowed).toBe(true);
      }
    });

    it('should block usage for user over limits', async () => {
      mockVerifier.setMockUser('test-user');
      
      // Exhaust the user's limit
      for (let i = 0; i < 100; i++) {
        UsageTracker.incrementUsage('test-user');
      }
      
      const result = await requireSessionWithUsage();
      
      expect(result).toBeInstanceOf(Response);
      
      if (result instanceof Response) {
        expect(result.status).toBe(429);
        const json = await result.json();
        expect(json.error).toBe('Free tier limit reached');
      }
    });

    it('should allow unlimited usage for paid users', async () => {
      mockVerifier.setMockUser('test-user');
      
      // Upgrade to paid
      UsageTracker.upgradeToPaid('test-user');
      
      // Exhaust the normal limit
      for (let i = 0; i < 150; i++) {
        UsageTracker.incrementUsage('test-user');
      }
      
      const result = await requireSessionWithUsage();
      
      expect(result).not.toBeInstanceOf(Response);
      
      if (!(result instanceof Response)) {
        expect(result.canProceed).toBe(true);
        expect(result.usage.allowed).toBe(true);
      }
    });
  });

  describe('extractToken', () => {
    it('should extract Bearer token from Authorization header', () => {
      const request = new Request('https://example.com', {
        headers: {
          'Authorization': 'Bearer test-token-123'
        }
      });
      
      const token = extractToken(request);
      
      expect(token).toBe('test-token-123');
    });

    it('should extract session from Cookie header', () => {
      const request = new Request('https://example.com', {
        headers: {
          'Cookie': '__session=cookie-token-456; other=value'
        }
      });
      
      const token = extractToken(request);
      
      expect(token).toBe('cookie-token-456');
    });

    it('should return undefined when no token found', () => {
      const request = new Request('https://example.com');
      
      const token = extractToken(request);
      
      expect(token).toBeUndefined();
    });
  });

  describe('createErrorResponse', () => {
    it('should create proper error response', async () => {
      const response = createErrorResponse('Test error', 400, 'Test message');
      
      expect(response.status).toBe(400);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      
      const json = await response.json();
      expect(json.error).toBe('Test error');
      expect(json.message).toBe('Test message');
    });

    it('should create error response without message', async () => {
      const response = createErrorResponse('Test error', 500);
      
      expect(response.status).toBe(500);
      
      const json = await response.json();
      expect(json.error).toBe('Test error');
      expect(json.message).toBeUndefined();
    });
  });

  describe('createUsageLimitResponse', () => {
    it('should create usage limit response with stats', async () => {
      const usage = {
        plan: 'free' as const,
        messageCount: 15,
        limit: 15,
        remaining: 0,
        resetDate: '2024-01-01'
      };
      
      const response = createUsageLimitResponse(usage);
      
      expect(response.status).toBe(429);
      
      const json = await response.json();
      expect(json.error).toBe('Free tier limit reached');
      expect(json.usage).toEqual(usage);
      expect(json.message).toContain('15 messages');
    });
  });
});

describe('UsageTracker Integration', () => {
  beforeEach(() => {
    UsageTracker.clearUsage('integration-test-user');
  });

  it('should track usage progression correctly', () => {
    const userId = 'integration-test-user';
    
    // Start with 0 usage
    const initial = UsageTracker.getUsageStats(userId);
    expect(initial.messageCount).toBe(0);
    expect(initial.plan).toBe('free');
    
    // Increment usage
    UsageTracker.incrementUsage(userId);
    const afterIncrement = UsageTracker.getUsageStats(userId);
    expect(afterIncrement.messageCount).toBe(1);
    
    // Check usage limits
    const usageCheck = UsageTracker.canSendMessage(userId);
    expect(usageCheck.allowed).toBe(true);
    expect(usageCheck.remaining).toBe(99); // 100 - 1
    
    // Upgrade to paid
    UsageTracker.upgradeToPaid(userId);
    const afterUpgrade = UsageTracker.getUsageStats(userId);
    expect(afterUpgrade.plan).toBe('paid');
    expect(afterUpgrade.limit).toBeNull();
    expect(afterUpgrade.remaining).toBeNull();
  });

  it('should handle usage reset correctly', () => {
    const userId = 'reset-test-user';
    
    // Set usage with past reset date
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    
    UsageTracker.setUsageForTesting(userId, {
      messageCount: 50,
      resetDate: pastDate.toISOString()
    });
    
    // Getting usage should trigger reset
    const usage = UsageTracker.getUsageStats(userId);
    expect(usage.messageCount).toBe(0);
  });
});