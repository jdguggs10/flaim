// Baseball ESPN MCP Server v3.0 - JWT-Only Authentication
// Focuses purely on ESPN API integration with JWT validation
// Authentication is handled by the separate flaim-auth service

import { JWTValidator } from '../auth/src/jwt-validator.js';
import { McpServerWithAuth } from './mcp/mcp-server.js';
import { UserCredentials } from './storage/user-credentials.js';

export interface Env {
  // JWT validation (shared secret with auth service)
  JWT_SECRET: string;
  
  // Encryption for ESPN credentials
  ENCRYPTION_KEY: string;
  
  // Durable Objects
  USER_DO: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    try {
      const jwtValidator = new JWTValidator(env.JWT_SECRET);
      
      // MCP endpoints - require JWT authentication from auth service
      if (url.pathname.startsWith('/mcp')) {
        const mcpServer = new McpServerWithAuth(env);
        return mcpServer.fetch(request);
      }
      
      // ESPN credential management endpoints
      if (url.pathname.startsWith('/credential/espn')) {
        return jwtValidator.requireAuth(request, async (request, user) => {
          // Route to user's Durable Object for ESPN credential storage
          const userStoreId = env.USER_DO.idFromString(user.sub);
          const userStore = env.USER_DO.get(userStoreId);
          
          // Forward request with auth context
          const authenticatedRequest = new Request(request, {
            headers: {
              ...Object.fromEntries(request.headers.entries()),
              'X-User-ID': user.sub,
              'X-User-Email': user.email,
              'X-User-Plan': user.plan
            }
          });
          
          return userStore.fetch(authenticatedRequest);
        });
      }
      
      // Health check for service monitoring
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ 
          status: 'healthy',
          service: 'baseball-espn-mcp',
          timestamp: new Date().toISOString()
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      // Service info endpoint
      if (url.pathname === '/') {
        return new Response(JSON.stringify({
          service: 'Baseball ESPN MCP Server',
          version: '3.0.0',
          description: 'ESPN fantasy baseball integration with MCP tools',
          authentication: 'JWT validation (handled by flaim-auth service)',
          endpoints: {
            '/mcp': 'MCP server endpoints',
            '/credential/espn': 'ESPN S2/SWID credential management',
            '/health': 'Health check'
          }
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      
      return new Response('Not Found', { 
        status: 404,
        headers: corsHeaders
      });
      
    } catch (error) {
      console.error('ESPN MCP server error:', error);
      
      if (error instanceof Response) {
        return error; // Authentication error response
      }
      
      return new Response(JSON.stringify({ 
        error: 'ESPN MCP server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};

// Export the Durable Object class
export { UserCredentials };