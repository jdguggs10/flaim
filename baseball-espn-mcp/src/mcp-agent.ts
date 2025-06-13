// MCP Agent implementation following documented pattern
// Reference: Responses API and MCP Tools.md section 6.4

import { McpAgent } from '@cloudflare/agents';
import { getLeagueMeta } from './tools/getLeagueMeta';
import { CredentialVault } from './kv';

export interface Env {
  ESPN_S2?: string;
  ESPN_SWID?: string;
  DB: D1Database;
  CREDENTIALS_KV: KVNamespace;
}

export class BaseballEspnMcpAgent extends McpAgent {
  constructor() {
    super();
  }

  // Define available tools following MCP specification
  async listTools() {
    return {
      tools: [
        {
          name: 'getLeagueMeta',
          description: 'Get league settings and scoring configuration for ESPN Fantasy Baseball',
          inputSchema: {
            type: 'object',
            properties: {
              leagueId: { 
                type: 'string',
                description: 'ESPN Fantasy Baseball league ID'
              },
              year: { 
                type: 'number', 
                default: 2025,
                description: 'Fantasy season year'
              }
            },
            required: ['leagueId']
          }
        }
      ]
    };
  }

  // Handle tool calls with OAuth authentication
  async callTool(name: string, args: any) {
    console.log('=== MCP AGENT TOOL CALL ===');
    console.log('Tool name:', name);
    console.log('Args:', JSON.stringify(args, null, 2));
    console.log('Context sub:', this.context?.props?.claims?.sub);

    // Get user credentials from KV using OAuth sub claim
    const vault = new CredentialVault(this.context.env.CREDENTIALS_KV);
    const sub = this.context?.props?.claims?.sub;
    
    let credentials = null;
    if (sub) {
      credentials = await vault.getCredentials(sub);
      console.log('Found credentials for sub:', sub, '- has credentials:', !!credentials);
    }

    // Fallback to environment variables if no OAuth credentials
    if (!credentials) {
      console.log('Using fallback environment credentials');
      credentials = {
        swid: this.context.env.ESPN_SWID || '',
        espn_s2: this.context.env.ESPN_S2 || '',
        created_at: '',
        updated_at: ''
      };
    }

    // Create enhanced env with user credentials
    const enhancedEnv = {
      ...this.context.env,
      ESPN_S2: credentials.espn_s2,
      ESPN_SWID: credentials.swid
    };

    console.log('Enhanced env has credentials:', !!(enhancedEnv.ESPN_S2 && enhancedEnv.ESPN_SWID));

    switch (name) {
      case 'getLeagueMeta':
        return await getLeagueMeta(args, enhancedEnv);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // Initialize MCP agent with protocol version
  async initialize() {
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'baseball-espn-mcp',
        version: '1.0.0'
      }
    };
  }
}