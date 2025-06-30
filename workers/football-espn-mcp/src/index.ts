// Football ESPN MCP Server v1.0 - Open Access
// Focuses on ESPN Fantasy Football API integration with KV storage

import { FootballMcpAgent } from './mcp/football-agent.js';

export interface Env {
  CF_KV_CREDENTIALS: KVNamespace;
  CF_ENCRYPTION_KEY: string;
  ESPN_S2?: string;
  ESPN_SWID?: string;
  NODE_ENV?: string;
  CLERK_SECRET_KEY?: string;
}

// Helper function for CORS headers
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-ID',
  };
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders();

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check endpoint with KV connectivity test
      if (url.pathname === '/health') {
        const healthData: any = {
          status: 'healthy', 
          service: 'football-espn-mcp',
          version: '1.0.0',
          timestamp: new Date().toISOString()
        };

        // Test KV connectivity (still needed for reading credentials from auth-worker)
        try {
          if (env.CF_KV_CREDENTIALS) {
            // Try a simple KV operation to verify connectivity
            await env.CF_KV_CREDENTIALS.get('__health_check__');
            healthData.kv_status = 'connected';
          } else {
            healthData.kv_status = 'not_configured';
            healthData.status = 'degraded';
          }
        } catch (error) {
          healthData.kv_status = 'error';
          healthData.kv_error = error instanceof Error ? error.message : 'Unknown KV error';
          healthData.status = 'degraded';
        }

        // Note: Credential storage now handled by auth-worker
        healthData.credential_storage = 'handled_by_auth_worker';

        const statusCode = healthData.status === 'healthy' ? 200 : 503;

        return new Response(JSON.stringify(healthData), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }


      // MCP endpoints - delegate to agent
      if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
        const agent = new FootballMcpAgent();
        return await agent.handleRequest(request, env);
      }

      // 404 for unknown endpoints
      return new Response(JSON.stringify({
        error: 'Endpoint not found'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};