/**
 * Cloudflare Workers deployment verification tests
 * Tests that workers are properly deployed and accessible in production
 */

import fetch from 'node-fetch';

describe('Cloudflare Worker Deployment', () => {
  const baseballWorkerUrl = process.env.TEST_BASEBALL_WORKER_URL;
  const footballWorkerUrl = process.env.TEST_FOOTBALL_WORKER_URL;

  beforeAll(() => {
    if (!baseballWorkerUrl || !footballWorkerUrl) {
      throw new Error('TEST_BASEBALL_WORKER_URL and TEST_FOOTBALL_WORKER_URL must be set for deployment tests');
    }
  });

  describe('Baseball ESPN MCP Worker', () => {
    test('is accessible and healthy', async () => {
      const response = await fetch(`${baseballWorkerUrl}/health`);
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toMatchObject({
        status: 'healthy',
        service: 'baseball-espn-mcp',
        environment: 'production'
      });
    });

    test('serves MCP capabilities', async () => {
      const response = await fetch(`${baseballWorkerUrl}/mcp`);
      
      expect(response.status).toBe(200);
      
      const data = await response.json() as any;
      expect(data.capabilities).toBeDefined();
      expect(data.serverInfo.name).toBe('baseball-espn-mcp');
    });

    test('enforces authentication on credential endpoints', async () => {
      const response = await fetch(`${baseballWorkerUrl}/credential/espn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          swid: 'test_swid',
          espn_s2: 'test_s2'
        })
      });

      expect(response.status).toBe(401);
    });

    test('has proper CORS headers', async () => {
      const response = await fetch(`${baseballWorkerUrl}/health`);
      
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  describe('Football ESPN MCP Worker', () => {
    test('is accessible and healthy', async () => {
      const response = await fetch(`${footballWorkerUrl}/health`);
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toMatchObject({
        status: 'healthy',
        service: 'football-espn-mcp',
        environment: 'production'
      });
    });

    test('serves MCP capabilities', async () => {
      const response = await fetch(`${footballWorkerUrl}/mcp`);
      
      expect(response.status).toBe(200);
      
      const data = await response.json() as any;
      expect(data.capabilities).toBeDefined();
      expect(data.serverInfo.name).toBe('football-espn-mcp');
    });

    test('has football-specific MCP tools', async () => {
      const response = await fetch(`${footballWorkerUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(200);
      
      const data = await response.json() as any;
      const toolNames = data.result.tools.map((tool: any) => tool.name);
      
      expect(toolNames).toContain('get_espn_football_league_info');
      expect(toolNames).toContain('get_espn_football_team');
      expect(toolNames).toContain('get_espn_football_matchups');
      expect(toolNames).toContain('get_espn_football_standings');
    });
  });

  describe('Worker Performance', () => {
    test('responds within acceptable time limits', async () => {
      const startTime = Date.now();
      
      const response = await fetch(`${baseballWorkerUrl}/health`);
      
      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(5000); // 5 second max response time
      expect(response.status).toBe(200);
    });

    test('handles concurrent requests', async () => {
      const requests = Array.from({ length: 10 }, () => 
        fetch(`${baseballWorkerUrl}/health`)
      );

      const responses = await Promise.all(requests);
      
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('Environment Configuration', () => {
    test('workers have production environment settings', async () => {
      const baseballResponse = await fetch(`${baseballWorkerUrl}/health`);
      const footballResponse = await fetch(`${footballWorkerUrl}/health`);

      const baseballData = await baseballResponse.json() as any;
      const footballData = await footballResponse.json() as any;

      expect(baseballData.environment).toBe('production');
      expect(footballData.environment).toBe('production');
    });

    test('development features are disabled', async () => {
      // Test that development ESPN credentials are not accessible
      const response = await fetch(`${baseballWorkerUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'tools/call',
          params: {
            name: 'get_espn_league_info',
            arguments: {
              leagueId: '123456',
              seasonId: '2024'
            }
          }
        })
      });

      // Should fail without proper authentication in production
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Security Headers', () => {
    test('includes security headers', async () => {
      const response = await fetch(`${baseballWorkerUrl}/health`);
      
      // Check for basic security headers
      expect(response.headers.get('x-content-type-options')).toBeTruthy();
    });

    test('prevents header spoofing attacks', async () => {
      const response = await fetch(`${baseballWorkerUrl}/credential/espn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Clerk-User-ID': 'fake_user_id'  // Attempt to spoof user ID
        },
        body: JSON.stringify({
          swid: 'test_swid',
          espn_s2: 'test_s2'
        })
      });

      // Should reject spoofed headers
      expect(response.status).toBe(401);
    });
  });
});