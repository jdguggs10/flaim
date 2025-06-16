/**
 * Local deployment tests for Baseball ESPN MCP Worker
 * Tests local development server functionality
 */

import { spawn, ChildProcess } from 'child_process';
import fetch from 'node-fetch';
import path from 'path';

describe('Baseball Worker Local Deployment', () => {
  let workerProcess: ChildProcess;
  const workerPort = 8787;
  const workerUrl = `http://localhost:${workerPort}`;
  const workerPath = path.join(__dirname, '../../../workers/baseball-espn-mcp');

  beforeAll(async () => {
    // Start local worker with wrangler dev
    workerProcess = spawn('wrangler', ['dev', '--local', '--port', workerPort.toString()], {
      cwd: workerPath,
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ENCRYPTION_KEY: process.env.TEST_ENCRYPTION_KEY,
        CLERK_SECRET_KEY: process.env.TEST_CLERK_SECRET_KEY
      }
    });

    // Wait for worker to start up
    await waitForWorkerStartup(workerUrl, 30000);
  }, 45000);

  afterAll(async () => {
    if (workerProcess) {
      workerProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  });

  describe('Health Check', () => {
    test('responds to health endpoint', async () => {
      const response = await fetch(`${workerUrl}/health`);
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toEqual({
        status: 'healthy',
        service: 'baseball-espn-mcp',
        environment: 'development',
        timestamp: expect.any(String)
      });
    });
  });

  describe('MCP Capabilities', () => {
    test('returns MCP server information', async () => {
      const response = await fetch(`${workerUrl}/mcp`);
      
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toMatchObject({
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'baseball-espn-mcp',
          version: expect.any(String)
        }
      });
    });

    test('lists available MCP tools', async () => {
      const response = await fetch(`${workerUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'tools/list',
          params: {}
        })
      });

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.result.tools).toBeInstanceOf(Array);
      
      const toolNames = data.result.tools.map((tool: any) => tool.name);
      expect(toolNames).toContain('get_espn_league_info');
      expect(toolNames).toContain('get_espn_team_roster');
      expect(toolNames).toContain('get_espn_matchups');
    });
  });

  describe('CORS Configuration', () => {
    test('handles preflight OPTIONS requests', async () => {
      const response = await fetch(`${workerUrl}/mcp`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type'
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('access-control-allow-methods')).toContain('POST');
      expect(response.headers.get('access-control-allow-headers')).toContain('Content-Type');
    });
  });

  describe('Authentication Endpoints', () => {
    test('credential endpoint requires authentication', async () => {
      const response = await fetch(`${workerUrl}/credential/espn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          swid: 'test_swid',
          espn_s2: 'test_s2'
        })
      });

      expect(response.status).toBe(401);
      
      const data = await response.json();
      expect(data.error).toContain('Authentication required');
    });

    test('discover-leagues endpoint requires authentication', async () => {
      const response = await fetch(`${workerUrl}/discover-leagues`);

      expect(response.status).toBe(401);
      
      const data = await response.json();
      expect(data.error).toContain('Authentication required');
    });
  });

  describe('Error Handling', () => {
    test('returns 404 for unknown endpoints', async () => {
      const response = await fetch(`${workerUrl}/unknown-endpoint`);
      
      expect(response.status).toBe(404);
    });

    test('handles malformed JSON gracefully', async () => {
      const response = await fetch(`${workerUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{'
      });

      expect(response.status).toBe(400);
    });
  });
});

/**
 * Wait for worker to start up by polling health endpoint
 */
async function waitForWorkerStartup(url: string, timeout: number): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.status === 200) {
        return;
      }
    } catch (error) {
      // Worker not ready yet, continue polling
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error(`Worker failed to start within ${timeout}ms`);
}