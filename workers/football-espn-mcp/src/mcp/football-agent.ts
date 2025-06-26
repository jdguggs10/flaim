import { EspnFootballApiClient } from '../espn-football-client';

export interface Env {
  CF_KV_CREDENTIALS: KVNamespace;
  CF_ENCRYPTION_KEY: string;
  ESPN_S2?: string;
  ESPN_SWID?: string;
  NODE_ENV?: string;
  CLERK_SECRET_KEY?: string;
}

export interface McpToolCall {
  tool: string;
  arguments: Record<string, any>;
}

export interface McpResponse {
  content: any;
  isError?: boolean;
}

export class FootballMcpAgent {
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
      // Extract Clerk user ID from headers (preferred) or fallback to anonymous
      const clerkUserId = request.headers.get('X-Clerk-User-ID') || 
                         request.headers.get('X-User-ID') || 
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
      console.error('Football MCP Agent error:', error);
      
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
      name: 'ESPN Fantasy Football MCP Server',
      version: '1.0.0',
      description: 'Open access MCP server for ESPN fantasy football data',
      sport: 'football',
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
        name: 'get_espn_football_league_info',
        description: 'Get ESPN fantasy football league information',
        inputSchema: {
          type: 'object',
          properties: {
            leagueId: {
              type: 'string',
              description: 'ESPN football league ID'
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
        name: 'get_espn_football_team',
        description: 'Get detailed team information from ESPN fantasy football league',
        inputSchema: {
          type: 'object',
          properties: {
            leagueId: { type: 'string', description: 'ESPN football league ID' },
            teamId: { type: 'string', description: 'Team ID within the league' },
            seasonId: { type: 'string', description: 'Season year', default: new Date().getFullYear().toString() },
            week: { type: 'number', description: 'Week number (optional)' }
          },
          required: ['leagueId', 'teamId']
        }
      },
      {
        name: 'get_espn_football_matchups',
        description: 'Get current week matchups from ESPN fantasy football league',
        inputSchema: {
          type: 'object',
          properties: {
            leagueId: { type: 'string', description: 'ESPN football league ID' },
            week: { type: 'number', description: 'Week number (optional, defaults to current week)' },
            seasonId: { type: 'string', description: 'Season year', default: new Date().getFullYear().toString() }
          },
          required: ['leagueId']
        }
      },
      {
        name: 'get_espn_football_standings',
        description: 'Get league standings from ESPN fantasy football league',
        inputSchema: {
          type: 'object',
          properties: {
            leagueId: { type: 'string', description: 'ESPN football league ID' },
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
      const result = await this.executeTool(tool, args, clerkUserId, env);
      
      return new Response(JSON.stringify({
        content: result.content,
        isError: result.isError || false
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error(`Football tool execution error for ${tool}:`, error);
      
      return new Response(JSON.stringify({
        content: `Football tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  private async executeTool(tool: string, args: Record<string, any>, clerkUserId: string, env: Env): Promise<McpResponse> {
    switch (tool) {
      case 'get_espn_football_league_info':
        return this.getEspnFootballLeagueInfo(args, clerkUserId, env);
      
      case 'get_espn_football_team':
        return this.getEspnFootballTeam(args, clerkUserId, env);
      
      case 'get_espn_football_matchups':
        return this.getEspnFootballMatchups(args, clerkUserId, env);
        
      case 'get_espn_football_standings':
        return this.getEspnFootballStandings(args, clerkUserId, env);
      
      default:
        throw new Error(`Unknown football tool: ${tool}`);
    }
  }

  private async getEspnFootballLeagueInfo(args: Record<string, any>, clerkUserId: string, env: Env): Promise<McpResponse> {
    try {
      const footballClient = new EspnFootballApiClient(env);
      
      const { leagueId, seasonId = new Date().getFullYear().toString() } = args;
      const league = await footballClient.fetchLeague(leagueId, parseInt(seasonId), 'mSettings', clerkUserId);

      return {
        content: {
          success: true,
          data: {
            id: league.id,
            name: league.settings?.name || 'Unknown League',
            size: league.settings?.size || 0,
            sport: 'football',
            scoringType: league.settings?.scoringSettings?.scoringType || 'Unknown',
            currentWeek: league.status?.currentMatchupPeriod || 1,
            season: seasonId,
            playoffTeamCount: league.settings?.playoffTeamCount || 0,
            regularSeasonMatchupPeriods: league.settings?.regularSeasonMatchupPeriods || 0,
            rosterSettings: league.settings?.rosterSettings
          },
          leagueId,
          year: parseInt(seasonId),
          sport: 'football'
        }
      };
    } catch (error) {
      return {
        content: `Failed to fetch football league info: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      };
    }
  }

  private async getEspnFootballTeam(args: Record<string, any>, clerkUserId: string, env: Env): Promise<McpResponse> {
    try {
      const footballClient = new EspnFootballApiClient(env);
      
      const { leagueId, teamId, seasonId = new Date().getFullYear().toString(), week } = args;
      const teamData = await footballClient.fetchTeam(leagueId, teamId, parseInt(seasonId), week, clerkUserId);

      return {
        content: {
          success: true,
          data: teamData,
          leagueId,
          teamId,
          year: parseInt(seasonId),
          sport: 'football'
        }
      };
    } catch (error) {
      return {
        content: `Failed to fetch football team: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      };
    }
  }

  private async getEspnFootballMatchups(args: Record<string, any>, clerkUserId: string, env: Env): Promise<McpResponse> {
    try {
      const footballClient = new EspnFootballApiClient(env);
      
      const { leagueId, week, seasonId = new Date().getFullYear().toString() } = args;
      const matchups = await footballClient.fetchMatchups(leagueId, week, parseInt(seasonId), clerkUserId);

      return {
        content: {
          success: true,
          data: matchups,
          leagueId,
          week,
          year: parseInt(seasonId),
          sport: 'football'
        }
      };
    } catch (error) {
      return {
        content: `Failed to fetch football matchups: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      };
    }
  }

  private async getEspnFootballStandings(args: Record<string, any>, clerkUserId: string, env: Env): Promise<McpResponse> {
    try {
      const footballClient = new EspnFootballApiClient(env);
      
      const { leagueId, seasonId = new Date().getFullYear().toString() } = args;
      const standings = await footballClient.fetchStandings(leagueId, parseInt(seasonId), clerkUserId);

      return {
        content: {
          success: true,
          data: standings,
          leagueId,
          year: parseInt(seasonId),
          sport: 'football'
        }
      };
    } catch (error) {
      return {
        content: `Failed to fetch football standings: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      };
    }
  }
}