// Fantasy Sports MCP Server v2.0 - Dual-Layer Authentication Architecture
// Reference: New authentication plan implementation

import { GitHubOAuthProvider } from './oauth/oauth-provider.js';
import { McpServerWithAuth } from './mcp/mcp-server.js';
import { StripeWebhookHandler } from './billing/stripe-webhook.js';
import { UserCredentials } from './storage/user-credentials.js';

export interface Env {
  // OAuth secrets
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  JWT_SECRET: string;
  
  // Stripe
  STRIPE_WEBHOOK_SECRET: string;
  
  // Encryption
  ENCRYPTION_KEY: string;
  
  // Durable Objects
  USER_DO: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    try {
      // Route to appropriate handlers
      if (url.pathname.startsWith('/mcp')) {
        // MCP endpoints - require JWT authentication
        const mcpServer = new McpServerWithAuth(env);
        return mcpServer.fetch(request);
      }
      
      if (url.pathname === '/webhook/stripe') {
        // Stripe webhook handler
        const stripeHandler = new StripeWebhookHandler(env);
        return stripeHandler.handleWebhook(request);
      }
      
      if (url.pathname.startsWith('/user/')) {
        // Direct user credential management (for frontend)
        const pathParts = url.pathname.split('/');
        if (pathParts.length >= 3) {
          const userId = pathParts[2];
          const userStoreId = env.USER_DO.idFromString(userId);
          const userStore = env.USER_DO.get(userStoreId);
          
          // Forward request to user's Durable Object
          const newUrl = new URL(request.url);
          newUrl.pathname = '/' + pathParts.slice(3).join('/');
          
          return userStore.fetch(newUrl.toString(), {
            method: request.method,
            headers: request.headers,
            body: request.body
          });
        }
      }
      
      // OAuth handlers for everything else
      const oauthProvider = new GitHubOAuthProvider(env);
      
      if (url.pathname === '/') {
        return new Response(oauthProvider.getLandingPageHtml(), {
          headers: { 'Content-Type': 'text/html' }
        });
      }
      
      if (url.pathname === '/authorize') {
        return oauthProvider.handleAuthorize(request);
      }
      
      if (url.pathname === '/callback') {
        return oauthProvider.handleCallback(request);
      }
      
      return new Response('Not Found', { status: 404 });
      
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
};

// Export the Durable Object class
export { UserCredentials };