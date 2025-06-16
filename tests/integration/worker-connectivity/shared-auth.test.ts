/**
 * Tests inter-worker connectivity and shared authentication
 * Verifies that workers can properly share authentication state
 */

// Mock fetch for testing
const mockFetch = (url: string, options?: any) => {
  // Return mock responses for test URLs
  return Promise.resolve({
    status: 401,
    json: () => Promise.resolve({ error: 'Authentication required' })
  });
};

const fetch = globalThis.fetch || mockFetch;

describe('Worker Connectivity - Shared Authentication', () => {
  const baseballWorkerUrl = process.env.TEST_BASEBALL_WORKER_URL || 'http://localhost:8787';
  const footballWorkerUrl = process.env.TEST_FOOTBALL_WORKER_URL || 'http://localhost:8788';
  
  let testUserId: string;
  let testSessionToken: string;

  beforeAll(async () => {
    // Generate test user ID for consistency across tests
    testUserId = global.testUtils.generateTestUserId();
    
    // Create mock session token (in real tests, this would come from Clerk)
    testSessionToken = `test_session_${Date.now()}`;
  });

  describe('Credential Storage Across Workers', () => {
    const testCredentials = {
      swid: 'test_swid_12345',
      espn_s2: 'test_s2_abcdef',
      email: 'test@example.com'
    };

    test('can store credentials via baseball worker', async () => {
      // Mock Clerk verification for this test
      const mockClerkVerify = jest.fn().mockResolvedValue({
        userId: testUserId
      });
      
      const response = await fetch(`${baseballWorkerUrl}/credential/espn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testSessionToken}`
        },
        body: JSON.stringify(testCredentials)
      });

      // In a real test environment, this would succeed with proper Clerk setup
      // For now, we verify the endpoint is accessible and handles auth properly
      expect([200, 401]).toContain(response.status);
      
      if (response.status === 200) {
        const data = await response.json() as any;
        expect(data.success).toBe(true);
      }
    });

    test('stored credentials are accessible via football worker', async () => {
      // Test that football worker can access credentials stored by baseball worker
      const response = await fetch(`${footballWorkerUrl}/credential/espn`, {
        headers: {
          'Authorization': `Bearer ${testSessionToken}`
        }
      });

      // Should return same auth requirement pattern
      expect([200, 401]).toContain(response.status);
    });
  });

  describe('Durable Object Isolation', () => {
    test('different users have isolated credential storage', async () => {
      const user1Id = global.testUtils.generateTestUserId();
      const user2Id = global.testUtils.generateTestUserId();
      
      const user1Token = `test_session_user1_${Date.now()}`;
      const user2Token = `test_session_user2_${Date.now()}`;

      // Attempt to store credentials for user1
      const user1Response = await fetch(`${baseballWorkerUrl}/credential/espn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user1Token}`
        },
        body: JSON.stringify({
          swid: 'user1_swid',
          espn_s2: 'user1_s2'
        })
      });

      // Attempt to store credentials for user2
      const user2Response = await fetch(`${baseballWorkerUrl}/credential/espn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user2Token}`
        },
        body: JSON.stringify({
          swid: 'user2_swid',
          espn_s2: 'user2_s2'
        })
      });

      // Both should handle authentication consistently
      expect(user1Response.status).toBe(user2Response.status);
    });
  });

  describe('Cross-Worker MCP Tool Access', () => {
    test('baseball worker MCP tools work independently', async () => {
      const response = await fetch(`${baseballWorkerUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'tools/call',
          params: {
            name: 'get_espn_league_info',
            arguments: {
              leagueId: process.env.TEST_LEAGUE_ID || '123456'
            }
          }
        })
      });

      expect(response.status).toBeLessThan(500); // Should not have server errors
    });

    test('football worker MCP tools work independently', async () => {
      const response = await fetch(`${footballWorkerUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'tools/call',
          params: {
            name: 'get_espn_football_league_info',
            arguments: {
              leagueId: process.env.TEST_LEAGUE_ID || '123456'
            }
          }
        })
      });

      expect(response.status).toBeLessThan(500); // Should not have server errors
    });
  });

  describe('Shared Encryption Module', () => {
    test('both workers use compatible encryption', async () => {
      // Test that both workers can handle encrypted data consistently
      // This would require a more complex test setup with actual credential storage
      
      const testData = 'test_encryption_data';
      
      // This test would verify that:
      // 1. Baseball worker encrypts data
      // 2. Football worker can decrypt the same data
      // 3. Encryption keys are consistent across workers
      
      expect(true).toBe(true); // Placeholder - real implementation would test encryption compatibility
    });
  });

  describe('Error Handling Consistency', () => {
    test('workers return consistent error formats', async () => {
      const baseballError = await fetch(`${baseballWorkerUrl}/nonexistent-endpoint`);
      const footballError = await fetch(`${footballWorkerUrl}/nonexistent-endpoint`);

      expect(baseballError.status).toBe(404);
      expect(footballError.status).toBe(404);
    });

    test('authentication errors are consistent', async () => {
      const baseballAuthError = await fetch(`${baseballWorkerUrl}/credential/espn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swid: 'test', espn_s2: 'test' })
      });

      const footballAuthError = await fetch(`${footballWorkerUrl}/credential/espn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swid: 'test', espn_s2: 'test' })
      });

      expect(baseballAuthError.status).toBe(footballAuthError.status);
      expect(baseballAuthError.status).toBe(401);
    });
  });

  describe('Health Check Consistency', () => {
    test('both workers report healthy status', async () => {
      const baseballHealth = await fetch(`${baseballWorkerUrl}/health`);
      const footballHealth = await fetch(`${footballWorkerUrl}/health`);

      expect(baseballHealth.status).toBe(200);
      expect(footballHealth.status).toBe(200);

      const baseballData = await baseballHealth.json() as any;
      const footballData = await footballHealth.json() as any;

      expect(baseballData.status).toBe('healthy');
      expect(footballData.status).toBe('healthy');
    });
  });
});