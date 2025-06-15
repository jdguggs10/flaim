// Baseball ESPN MCP Server v4.0 - Open Access
// Focuses purely on ESPN API integration with optional credential storage
// No authentication required for MCP endpoints

import { McpAgent } from './mcp/agent.js';
import { UserCredentials } from './storage/user-credentials.js';
import { EspnStorage } from '../../../auth/espn';
import { createClerkClient } from '@clerk/backend';

export interface Env {
  // Encryption for ESPN credentials
  ENCRYPTION_KEY: string;
  
  // Clerk authentication (required for production)
  CLERK_SECRET_KEY?: string;
  
  // ESPN credentials fallback (for development only)
  ESPN_S2?: string;
  ESPN_SWID?: string;
  
  // Environment
  NODE_ENV?: string;
  
  // Durable Objects
  USER_DO: DurableObjectNamespace;
}

// Helper function to verify Clerk session and extract user ID
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

  try {
    // Initialize Clerk with the secret key
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
    
    // Extract session token from Authorization header or cookie
    const authHeader = request.headers.get('Authorization');
    const sessionToken = authHeader?.replace('Bearer ', '') || 
                        request.headers.get('Cookie')?.match(/__session=([^;]+)/)?.[1];
    
    if (!sessionToken) {
      return { userId: null, error: 'No session token found' };
    }

    // Verify the session
    const session = await clerk.sessions.verifySession(sessionToken, {
      jwtKey: env.CLERK_SECRET_KEY
    });

    if (!session || !session.userId) {
      return { userId: null, error: 'Invalid session' };
    }

    // Return the verified user ID from the session
    return { userId: session.userId };
  } catch (error) {
    console.error('Clerk verification failed:', error);
    return { userId: null, error: 'Session verification failed' };
  }
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
      // MCP endpoints - open access, no authentication required
      if (url.pathname.startsWith('/mcp')) {
        const mcpAgent = new McpAgent(env);
        return mcpAgent.handleRequest(request);
      }
      
      // ESPN credential management endpoints - require verified Clerk session
      if (url.pathname === '/credential/espn') {
        // Verify Clerk session and get authenticated user ID
        const { userId: clerkUserId, error } = await verifyClerkSession(request, env);
        
        if (!clerkUserId || error) {
          return new Response(JSON.stringify({ 
            error: error || 'Authentication required',
            message: 'Valid Clerk session required for ESPN credential management'
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        // Route to user's Durable Object for ESPN credential storage
        const userStoreId = env.USER_DO.idFromString(clerkUserId);
        const userStore = env.USER_DO.get(userStoreId);
        
        // Use the new method that accepts clerkUserId parameter
        const credentialHandler = userStore as any;
        
        // Forward to the new handler method
        return credentialHandler.handleEspnCredentialsWithUserId(request, corsHeaders, clerkUserId);
      }
      
      // League discovery endpoint - require verified Clerk session
      if (url.pathname === '/discover-leagues') {
        // Verify Clerk session and get authenticated user ID
        const { userId: clerkUserId, error } = await verifyClerkSession(request, env);
        
        if (!clerkUserId || error) {
          return new Response(JSON.stringify({ 
            error: error || 'Authentication required',
            message: 'Valid Clerk session required for league discovery'
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Import league discovery tool
        const { discoverUserLeagues } = await import('./tools/discoverLeagues.js');
        
        try {
          const result = await discoverUserLeagues({ clerkUserId }, env);
          
          return new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        } catch (error) {
          console.error('League discovery endpoint error:', error);
          return new Response(JSON.stringify({
            success: false,
            error: 'Internal error during league discovery'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
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
          version: '4.0.0',
          description: 'ESPN fantasy baseball integration with MCP tools',
          authentication: 'None required (open access)',
          endpoints: {
            '/mcp': 'MCP server endpoints (open access)',
            '/credential/espn': 'ESPN S2/SWID credential management (requires Clerk authentication)',
            '/discover-leagues': 'Automatic league discovery via ESPN gambit dashboard (requires Clerk authentication)',
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
        return error; // Error response
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

// Export the Durable Object classes
export { UserCredentials, EspnStorage };