// OAuth handler for ESPN credential management
// Reference: Responses API and MCP Tools.md section 6.4

import { CredentialVault } from './kv';

export interface Env {
  CREDENTIALS_KV: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}

export class EspnOAuthHandler {
  constructor(private env: Env) {}

  // Handle OAuth credential storage endpoints
  async handleCredentialEndpoint(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const vault = new CredentialVault(this.env.CREDENTIALS_KV);
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    try {
      if (request.method === 'POST' && url.pathname === '/oauth/credentials') {
        // Store credentials using OAuth pattern
        const authHeader = request.headers.get('Authorization');
        const sub = this.extractSubFromAuth(authHeader);
        
        if (!sub) {
          return new Response(JSON.stringify({ 
            error: 'Invalid or missing Authorization header' 
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const { email, espn_s2, espn_swid } = await request.json();
        
        if (!espn_s2 || !espn_swid) {
          return new Response(JSON.stringify({ 
            error: 'Missing required fields: espn_s2, espn_swid' 
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        await vault.storeCredentials(sub, {
          swid: espn_swid,
          espn_s2,
          email
        });

        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Credentials stored successfully' 
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (request.method === 'GET' && url.pathname === '/oauth/credentials') {
        // Get credentials using OAuth pattern
        const authHeader = request.headers.get('Authorization');
        const sub = this.extractSubFromAuth(authHeader);
        
        if (!sub) {
          return new Response(JSON.stringify({ 
            error: 'Invalid or missing Authorization header' 
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const credentials = await vault.getCredentials(sub);
        
        return new Response(JSON.stringify({
          hasCredentials: !!credentials,
          email: credentials?.email || null
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (request.method === 'DELETE' && url.pathname === '/oauth/credentials') {
        // Remove credentials using OAuth pattern
        const authHeader = request.headers.get('Authorization');
        const sub = this.extractSubFromAuth(authHeader);
        
        if (!sub) {
          return new Response(JSON.stringify({ 
            error: 'Invalid or missing Authorization header' 
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        await vault.removeCredentials(sub);

        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Credentials removed successfully' 
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      return new Response('Not found', { 
        status: 404,
        headers: corsHeaders
      });

    } catch (error) {
      console.error('OAuth credential endpoint error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  // Extract sub from Authorization header (OAuth pattern)
  private extractSubFromAuth(authHeader: string | null): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    try {
      // In a real implementation, you would verify the JWT and extract the sub claim
      // For now, we'll use a simple approach - the token IS the sub for demo purposes
      const token = authHeader.slice(7); // Remove "Bearer "
      
      // TODO: Replace with proper JWT verification
      // const decoded = jwt.verify(token, JWT_SECRET);
      // return decoded.sub;
      
      // For demo: use the token as the sub directly
      return token;
    } catch (error) {
      console.error('Failed to extract sub from auth header:', error);
      return null;
    }
  }
}