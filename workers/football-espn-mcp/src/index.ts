// Football ESPN MCP Server v1.0 - Open Access
// Focuses on ESPN Fantasy Football API integration with shared authentication
// Uses flaim/auth/espn for credential management

import { FootballMcpAgent } from './mcp/football-agent.js';
import { EspnStorage } from '@flaim/auth/workers/espn/storage';
import { createClerkClient } from '@clerk/backend';

export interface Env {
  // Shared encryption for ESPN credentials (from auth module)
  ENCRYPTION_KEY: string;
  
  // Clerk authentication (required for production)
  CLERK_SECRET_KEY?: string;
  
  // ESPN credentials fallback (for development only)
  ESPN_S2?: string;
  ESPN_SWID?: string;
  
  // Environment
  NODE_ENV?: string;
  
  // Durable Object binding for credential storage
  USER_DO: DurableObjectNamespace;
}

// Verify Clerk session server-side for security
async function verifyClerkSession(request: Request, env: Env): Promise<{ userId: string | null; error?: string }> {
  // Skip verification in development mode if no Clerk secret provided
  if (!env.CLERK_SECRET_KEY) {
    if (env.NODE_ENV === 'development') {
      console.warn('⚠️ Development mode: Skipping Clerk verification. Add CLERK_SECRET_KEY for security.');
      // In development, return a default user ID for testing
      return { userId: 'dev_user_default' };
    } else {
      return { userId: null, error: 'Clerk authentication required in production' };
    }
  }

  const authHeader = request.headers.get('Authorization');
  const sessionToken = authHeader?.replace('Bearer ', '');
  
  if (!sessionToken) {
    return { userId: null, error: 'No session token found' };
  }

  try {
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
    const session = await clerk.sessions.verifySession(sessionToken, env.CLERK_SECRET_KEY);
    
    return { userId: session.userId };
  } catch (error) {
    console.error('Clerk session verification failed:', error);
    return { userId: null, error: 'Invalid session' };
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-ID',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      // Handle ESPN credential endpoints (require Clerk auth in production)
      if (url.pathname === '/credential/espn') {
        const { userId, error } = await verifyClerkSession(request, env);
        
        if (!userId) {
          return new Response(JSON.stringify({
            error: 'Authentication required',
            message: error || 'Please sign in to manage ESPN credentials'
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Route to user's Durable Object for ESPN credential storage
        const userStoreId = env.USER_DO.idFromString(userId);
        const userStore = env.USER_DO.get(userStoreId);
        
        // Use the direct method that accepts userId parameter (matches baseball worker pattern)
        const credentialHandler = userStore as any;
        
        // Forward to the handler method with verified user ID
        return credentialHandler.handleEspnCredentialsWithUserId(request, corsHeaders, userId);
      }

      // Handle MCP endpoints (open access, no auth required)
      if (url.pathname.startsWith('/mcp') || url.pathname === '/') {
        // Handle specific basic league info endpoint for onboarding
        if (url.pathname === '/mcp/espn/v3/basic' && request.method === 'POST') {
          const { getBasicLeagueInfo } = await import('./mcp/basic-league-info.js');
          
          try {
            const requestData = await request.json();
            const result = await getBasicLeagueInfo(requestData, env);
            
            return new Response(JSON.stringify(result), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          } catch (error) {
            console.error('Basic league info endpoint error:', error);
            return new Response(JSON.stringify({
              success: false,
              error: 'Failed to process basic league info request'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        }
        
        // Default MCP agent handling
        const footballAgent = new FootballMcpAgent(env);
        return footballAgent.handleRequest(request);
      }

      // Health check endpoint
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({
          status: 'healthy',
          service: 'football-espn-mcp',
          version: '1.1.0',
          sports: ['football', 'basketball', 'hockey'],
          endpoints: {
            '/mcp': 'MCP server endpoints (open access)',
            '/mcp/espn/v3/basic': 'Basic league information for onboarding auto-pull (all sports)',
            '/credential/espn': 'ESPN S2/SWID credential management (requires Clerk authentication)',
            '/health': 'Health check'
          },
          timestamp: new Date().toISOString()
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      return new Response('Not Found', { 
        status: 404, 
        headers: corsHeaders
      });
      
    } catch (error) {
      console.error('Football ESPN MCP server error:', error);
      
      if (error instanceof Response) {
        return error; // Error response
      }
      
      return new Response(JSON.stringify({ 
        error: 'Football ESPN MCP server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};

// Export the Durable Object class (shared from auth module)
export { EspnStorage };