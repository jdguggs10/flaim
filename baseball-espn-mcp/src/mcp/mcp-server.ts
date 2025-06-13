/**
 * MCP Server using @cloudflare/agents
 * Provides proper MCP protocol implementation with JWT authentication
 */

import { Agent } from '@cloudflare/agents';
import { JWTHandler } from '../auth/jwt-handler.js';
import { McpAgent } from './agent.js';

export interface Env {
  JWT_SECRET: string;
  USER_DO: DurableObjectNamespace;
}

export class McpServerWithAuth extends Agent {
  private jwtHandler: JWTHandler;
  private mcpAgent: McpAgent;

  constructor(env: Env) {
    super();
    this.jwtHandler = new JWTHandler(env);
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
        const authHeader = request.headers.get('Authorization');
        const token = this.jwtHandler.extractTokenFromHeader(authHeader);
        
        if (!token) {
          return new Response(JSON.stringify({ 
            error: 'Authentication required',
            message: 'Bearer token required for MCP access'
          }), {
            status: 401,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }

        // Validate JWT token
        const payload = await this.jwtHandler.validateToken(token);
        
        // Add authentication context to request
        const authenticatedRequest = new Request(request, {
          headers: {
            ...Object.fromEntries(request.headers.entries()),
            'X-User-ID': payload.sub,
            'X-User-Plan': payload.plan,
            'X-User-Email': payload.email || ''
          }
        });

        return this.mcpAgent.handleRequest(authenticatedRequest);
      }

      // Handle unauthenticated info requests
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
      name: 'Fantasy Sports MCP',
      version: '2.0.0',
      description: 'Dual-layer authenticated MCP server for fantasy sports integration',
      capabilities: {
        tools: true,
        resources: false,
        prompts: false
      },
      authentication: {
        type: 'Bearer',
        description: 'JWT token required for all authenticated endpoints'
      },
      tools: await this.mcpAgent.getAvailableTools()
    };
  }
}