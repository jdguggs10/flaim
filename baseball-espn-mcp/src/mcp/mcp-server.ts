/**
 * MCP Server using @cloudflare/agents
 * Provides proper MCP protocol implementation with JWT authentication
 */

import { Agent } from '@cloudflare/agents';
import { JWTValidator } from '../../auth/src/jwt-validator.js';
import { McpAgent } from './agent.js';

export interface Env {
  JWT_SECRET: string;
  USER_DO: DurableObjectNamespace;
}

export class McpServerWithAuth extends Agent {
  private jwtValidator: JWTValidator;
  private mcpAgent: McpAgent;

  constructor(env: Env) {
    super();
    this.jwtValidator = new JWTValidator(env.JWT_SECRET);
    this.mcpAgent = new McpAgent(env);
  }

  /**
   * Override the Agent's fetch method to add JWT authentication
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // CORS handling
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }

    try {
      // Authenticate all MCP requests except info endpoint
      if (url.pathname !== '/mcp' && url.pathname !== '/mcp/') {
        return this.jwtValidator.requireAuth(request, async (request, user) => {
          // Add authentication context to request
          const authenticatedRequest = new Request(request, {
            headers: {
              ...Object.fromEntries(request.headers.entries()),
              'X-User-ID': user.sub,
              'X-User-Plan': user.plan,
              'X-User-Email': user.email
            }
          });

          return this.mcpAgent.handleRequest(authenticatedRequest);
        });
      }

      // Handle unauthenticated info requests (server capabilities, etc.)
      return this.mcpAgent.handleRequest(request);

    } catch (error) {
      console.error('MCP server error:', error);
      
      if (error instanceof Response) {
        return error; // JWT validation error
      }

      return new Response(JSON.stringify({
        error: 'MCP server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }

  /**
   * Provide MCP server information
   */
  async getServerInfo(): Promise<any> {
    return {
      name: 'Baseball ESPN MCP',
      version: '3.0.0',
      description: 'ESPN fantasy baseball integration with MCP tools - authentication handled by flaim-auth service',
      capabilities: {
        tools: true,
        resources: false,
        prompts: false
      },
      authentication: {
        type: 'Bearer',
        description: 'JWT token minted by flaim-auth service required',
        issuer: 'flaim-auth',
        audience: 'flaim-platform'
      },
      tools: await this.mcpAgent.getAvailableTools()
    };
  }
}