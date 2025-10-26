
export interface Env {
  NODE_ENV?: string;
  CLERK_SECRET_KEY?: string;
  AUTH_WORKER_URL: string;
}

export interface McpToolCall {
  tool: string;
  arguments: Record<string, any>;
}

export interface McpResponse {
  content: any;
  isError?: boolean;
}

export class McpAgent {
  constructor() {}

  async handleRequest(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Extract Clerk user ID from headers or fallback to anonymous
      const clerkUserId = request.headers.get('X-Clerk-User-ID') || 
                         new URL(request.url).searchParams.get('clerkUserId') ||
                         'anonymous';

      const url = new URL(request.url);
      
      // Handle MCP endpoints
      if (url.pathname === '/mcp/tools/list') {
        return this.handleToolsList(clerkUserId, corsHeaders);
      }
      
      if (url.pathname === '/mcp/tools/call') {
        return this.handleToolCall(request, clerkUserId, corsHeaders, env);
      }
      
      if (url.pathname === '/mcp') {
        return this.handleMcpRoot(corsHeaders);
      }

      return new Response('Not Found', { 
        status: 404, 
        headers: corsHeaders 
      });

    } catch (error) {
      console.error('MCP Agent error:', error);
      
      if (error instanceof Response) {
        return error;
      }

      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  private async handleMcpRoot(corsHeaders: Record<string, string>): Promise<Response> {
    return new Response(JSON.stringify({
      name: 'Fantasy Sports MCP Server',
      version: '4.0.0',
      description: 'Open access MCP server for fantasy sports data',
      capabilities: {
        tools: true,
        resources: false,
        prompts: false
      }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  private async handleToolsList(_clerkUserId: string, corsHeaders: Record<string, string>): Promise<Response> {
    const tools = [
      {
        name: 'get_espn_league_info',
        description: 'Get ESPN fantasy league information',
        inputSchema: {
          type: 'object',
          properties: {
            leagueId: {
              type: 'string',
              description: 'ESPN league ID'
            },
            seasonId: {
              type: 'string',
              description: 'Season year (e.g., "2024")',
              default: new Date().getFullYear().toString()
            }
          },
          required: ['leagueId']
        }
      },
      {
        name: 'get_espn_team_roster',
        description: 'Get detailed team roster from ESPN fantasy league',
        inputSchema: {
          type: 'object',
          properties: {
            leagueId: { type: 'string', description: 'ESPN league ID' },
            teamId: { type: 'string', description: 'Team ID within the league' },
            seasonId: { type: 'string', description: 'Season year', default: new Date().getFullYear().toString() }
          },
          required: ['leagueId', 'teamId']
        }
      },
      {
        name: 'get_espn_matchups',
        description: 'Get current week matchups from ESPN fantasy league',
        inputSchema: {
          type: 'object',
          properties: {
            leagueId: { type: 'string', description: 'ESPN league ID' },
            week: { type: 'number', description: 'Week number (optional, defaults to current week)' },
            seasonId: { type: 'string', description: 'Season year', default: new Date().getFullYear().toString() }
          },
          required: ['leagueId']
        }
      }
    ];

    return new Response(JSON.stringify({ tools }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  private async handleToolCall(request: Request, clerkUserId: string, corsHeaders: Record<string, string>, env: Env): Promise<Response> {
    const { tool, arguments: args } = await request.json() as McpToolCall;

    try {
      const authHeader = request.headers.get('Authorization');
      const result = await this.executeTool(tool, args, clerkUserId, env, authHeader);
      
      return new Response(JSON.stringify({
        content: result.content,
        isError: result.isError || false
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error(`Tool execution error for ${tool}:`, error);
      
      return new Response(JSON.stringify({
        content: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  private async executeTool(tool: string, args: Record<string, any>, clerkUserId: string, env: Env, authHeader?: string | null): Promise<McpResponse> {
    switch (tool) {
      case 'get_espn_league_info':
        return this.getEspnLeagueInfo(args, clerkUserId, env, authHeader);
      
      case 'get_espn_team_roster':
        return this.getEspnTeamRoster(args, clerkUserId, env, authHeader);
      
      case 'get_espn_matchups':
        return this.getEspnMatchups(args, clerkUserId, env, authHeader);
      
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async getEspnLeagueInfo(args: Record<string, any>, clerkUserId: string, env: Env, authHeader?: string | null): Promise<McpResponse> {
    try {
      const { EspnApiClient } = await import('../espn');
      const espnClient = new EspnApiClient(env, { authHeader });
      
      const { leagueId, seasonId = new Date().getFullYear().toString() } = args;
      const league = await espnClient.fetchLeague(leagueId, parseInt(seasonId), 'mSettings', clerkUserId);
      
      const { getLeagueMeta } = await import('../tools/getLeagueMeta');
      const metadata = await getLeagueMeta(
        { leagueId: league.id.toString(), year: league.seasonId },
        env
      );

      return {
        content: {
          success: true,
          data: metadata,
          leagueId,
          year: parseInt(seasonId)
        }
      };
    } catch (error) {
      return {
        content: `Failed to fetch league info: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      };
    }
  }

  private async getEspnTeamRoster(args: Record<string, any>, clerkUserId: string, env: Env, authHeader?: string | null): Promise<McpResponse> {
    try {
      const { EspnApiClient } = await import('../espn');
      const espnClient = new EspnApiClient(env, { authHeader });
      
      const { leagueId, teamId, seasonId = new Date().getFullYear().toString() } = args;
      const roster = await espnClient.fetchRoster(leagueId, teamId, parseInt(seasonId), undefined, clerkUserId);

      return {
        content: {
          success: true,
          data: roster,
          leagueId,
          teamId,
          year: parseInt(seasonId)
        }
      };
    } catch (error) {
      return {
        content: `Failed to fetch team roster: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      };
    }
  }

  private async getEspnMatchups(args: Record<string, any>, clerkUserId: string, env: Env, authHeader?: string | null): Promise<McpResponse> {
    try {
      const { EspnApiClient } = await import('../espn');
      const espnClient = new EspnApiClient(env, { authHeader });
      
      const { leagueId, week, seasonId = new Date().getFullYear().toString() } = args;
      const league = await espnClient.fetchLeague(leagueId, parseInt(seasonId), 'mMatchup', clerkUserId);

      return {
        content: {
          success: true,
          data: league,
          leagueId,
          week,
          year: parseInt(seasonId)
        }
      };
    } catch (error) {
      return {
        content: `Failed to fetch matchups: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      };
    }
  }


}
