// Football ESPN MCP Server v1.0 - Open Access
// Focuses on ESPN Fantasy Football API integration with KV storage

import { FootballMcpAgent } from './mcp/football-agent.js';
import { EspnKVStorage, EspnKVStorageAPI } from '@flaim/auth/espn/kv-storage';

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

async function handleCredentialStorage(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
      // Get Clerk user ID from header
      const clerkUserId = request.headers.get('X-Clerk-User-ID');
      if (!clerkUserId) {
        return new Response(JSON.stringify({
          error: 'Missing X-Clerk-User-ID header'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const api = new EspnKVStorageAPI(
        new EspnKVStorage({ 
          kv: env.CF_KV_CREDENTIALS, 
          encryptionKey: env.CF_ENCRYPTION_KEY 
        })
      );

      if (request.method === 'POST' || request.method === 'PUT') {
        const body = await request.json() as { swid: string; s2: string; email?: string };
        return await api.handleSetCredentials(clerkUserId, body);
      } else if (request.method === 'GET') {
        return await api.handleGetCredentials(clerkUserId);
      } else if (request.method === 'DELETE') {
        return await api.handleDeleteCredentials(clerkUserId);
      }

      return new Response(JSON.stringify({
        error: 'Method not allowed'
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('Credential storage error:', error);
      return new Response(JSON.stringify({
        error: 'Failed to process credentials',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
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

        // Test KV connectivity
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

        // Test encryption key
        if (env.CF_ENCRYPTION_KEY) {
          healthData.encryption_status = 'configured';
        } else {
          healthData.encryption_status = 'missing';
          healthData.status = 'degraded';
        }

        const statusCode = healthData.status === 'healthy' ? 200 : 503;

        return new Response(JSON.stringify(healthData), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Credential storage endpoint
      if (url.pathname === '/credentials') {
        return await handleCredentialStorage(request, env, corsHeaders);
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