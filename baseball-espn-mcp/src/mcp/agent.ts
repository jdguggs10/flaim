import { JWTHandler, JWTPayload } from '../auth/jwt-handler';
import { SubscriptionValidator, AuthContext } from '../billing/subscription-check';
import { UserCredentials, EspnCredentials } from '../storage/user-credentials';

export interface Env {
  USER_DO: DurableObjectNamespace;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
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
  private jwtHandler: JWTHandler;

  constructor(private env: Env) {
    this.jwtHandler = new JWTHandler(env);
  }

  async handleRequest(request: Request): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Validate JWT token
      const authHeader = request.headers.get('Authorization');
      const token = this.jwtHandler.extractTokenFromHeader(authHeader);
      
      if (!token) {
        return new Response(JSON.stringify({ 
          error: 'Missing Authorization header' 
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const payload = await this.jwtHandler.validateToken(token);
      const context = SubscriptionValidator.createContext(payload);

      const url = new URL(request.url);
      
      // Handle MCP endpoints
      if (url.pathname === '/mcp/tools/list') {
        return this.handleToolsList(context, corsHeaders);
      }
      
      if (url.pathname === '/mcp/tools/call') {
        return this.handleToolCall(request, context, corsHeaders);
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
      version: '2.0.0',
      description: 'Secure MCP server for fantasy sports data access',
      capabilities: {
        tools: true,
        resources: false,
        prompts: false
      }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  private async handleToolsList(context: AuthContext, corsHeaders: Record<string, string>): Promise<Response> {
    const userPlan = SubscriptionValidator.getUserPlan(context);
    
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
      }
    ];

    // Pro-only tools
    if (userPlan === 'pro') {
      tools.push(
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
      );
    }

    return new Response(JSON.stringify({ tools }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  private async handleToolCall(request: Request, context: AuthContext, corsHeaders: Record<string, string>): Promise<Response> {
    const { tool, arguments: args } = await request.json() as McpToolCall;

    try {
      const result = await this.executeTool(tool, args, context);
      
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

  private async executeTool(tool: string, args: Record<string, any>, context: AuthContext): Promise<McpResponse> {
    const userId = SubscriptionValidator.getUserId(context);

    switch (tool) {
      case 'get_espn_league_info':
        return this.getEspnLeagueInfo(args, userId);
      
      case 'get_espn_team_roster':
        SubscriptionValidator.validateSubscription(context); // Pro only
        return this.getEspnTeamRoster(args, userId);
      
      case 'get_espn_matchups':
        SubscriptionValidator.validateSubscription(context); // Pro only
        return this.getEspnMatchups(args, userId);
      
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async getEspnLeagueInfo(args: Record<string, any>, userId: string): Promise<McpResponse> {
    const { leagueId, seasonId = new Date().getFullYear().toString() } = args;

    if (!leagueId) {
      return {
        content: 'Missing required parameter: leagueId',
        isError: true
      };
    }

    const credentials = await this.getEspnCredentials(userId);
    if (!credentials) {
      return {
        content: 'ESPN credentials not found. Please link your ESPN account first.',
        isError: true
      };
    }

    try {
      const response = await this.fetchEspnApi(
        `/fantasy/v2/leagues/${leagueId}?seasonId=${seasonId}`,
        credentials
      );

      if (!response.ok) {
        return {
          content: `ESPN API error: ${response.status} ${response.statusText}`,
          isError: true
        };
      }

      const data = await response.json();
      
      return {
        content: {
          league: {
            id: data.id,
            name: data.settings?.name || 'Unknown League',
            size: data.settings?.size || 0,
            scoringType: data.settings?.scoringSettings?.scoringType || 'Unknown',
            currentWeek: data.status?.currentMatchupPeriod || 1,
            season: seasonId
          }
        }
      };

    } catch (error) {
      return {
        content: `Failed to fetch ESPN league info: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      };
    }
  }

  private async getEspnTeamRoster(args: Record<string, any>, userId: string): Promise<McpResponse> {
    const { leagueId, teamId, seasonId = new Date().getFullYear().toString() } = args;

    if (!leagueId || !teamId) {
      return {
        content: 'Missing required parameters: leagueId, teamId',
        isError: true
      };
    }

    const credentials = await this.getEspnCredentials(userId);
    if (!credentials) {
      return {
        content: 'ESPN credentials not found. Please link your ESPN account first.',
        isError: true
      };
    }

    try {
      const response = await this.fetchEspnApi(
        `/fantasy/v2/leagues/${leagueId}/teams/${teamId}?seasonId=${seasonId}`,
        credentials
      );

      if (!response.ok) {
        return {
          content: `ESPN API error: ${response.status} ${response.statusText}`,
          isError: true
        };
      }

      const data = await response.json();
      
      return {
        content: {
          team: {
            id: data.id,
            name: data.name || `Team ${teamId}`,
            owner: data.owners?.[0]?.displayName || 'Unknown Owner',
            record: data.record || {},
            roster: data.roster?.entries?.map((entry: any) => ({
              playerId: entry.playerId,
              playerName: entry.playerPoolEntry?.player?.fullName || 'Unknown Player',
              position: entry.playerPoolEntry?.player?.defaultPositionId || 0,
              status: entry.lineupSlotId
            })) || []
          }
        }
      };

    } catch (error) {
      return {
        content: `Failed to fetch ESPN team roster: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      };
    }
  }

  private async getEspnMatchups(args: Record<string, any>, userId: string): Promise<McpResponse> {
    const { leagueId, week, seasonId = new Date().getFullYear().toString() } = args;

    if (!leagueId) {
      return {
        content: 'Missing required parameter: leagueId',
        isError: true
      };
    }

    const credentials = await this.getEspnCredentials(userId);
    if (!credentials) {
      return {
        content: 'ESPN credentials not found. Please link your ESPN account first.',
        isError: true
      };
    }

    try {
      const weekParam = week ? `&scoringPeriodId=${week}` : '';
      const response = await this.fetchEspnApi(
        `/fantasy/v2/leagues/${leagueId}/matchups?seasonId=${seasonId}${weekParam}`,
        credentials
      );

      if (!response.ok) {
        return {
          content: `ESPN API error: ${response.status} ${response.statusText}`,
          isError: true
        };
      }

      const data = await response.json();
      
      return {
        content: {
          matchups: data.map((matchup: any) => ({
            id: matchup.id,
            week: matchup.matchupPeriodId,
            homeTeam: {
              id: matchup.home?.teamId,
              score: matchup.home?.totalPoints || 0
            },
            awayTeam: {
              id: matchup.away?.teamId, 
              score: matchup.away?.totalPoints || 0
            },
            winner: matchup.winner
          }))
        }
      };

    } catch (error) {
      return {
        content: `Failed to fetch ESPN matchups: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isError: true
      };
    }
  }

  private async getEspnCredentials(userId: string): Promise<EspnCredentials | null> {
    const userStoreId = this.env.USER_DO.idFromString(userId);
    const userStore = this.env.USER_DO.get(userStoreId);
    
    try {
      const response = await userStore.fetch('https://fake.host/credentials/espn');
      if (!response.ok) {
        return null;
      }

      // Get the UserCredentials instance to call internal method
      const credentialsInstance = new UserCredentials(
        {} as any, // DurableObjectState not needed for this call
        { ENCRYPTION_KEY: this.env.ENCRYPTION_KEY }
      );
      
      return await credentialsInstance.getEspnCredentialsForApi();
    } catch (error) {
      console.error('Failed to get ESPN credentials:', error);
      return null;
    }
  }

  private async fetchEspnApi(path: string, credentials: EspnCredentials): Promise<Response> {
    const url = `https://fantasy.espn.com/apis/v3${path}`;
    
    return fetch(url, {
      headers: {
        'Cookie': `SWID=${credentials.swid}; espn_s2=${credentials.espn_s2}`,
        'User-Agent': 'fantasy-mcp-server/2.0',
        'Accept': 'application/json'
      }
    });
  }

  // Static method for routing
  static Router = class {
    static async fetch(request: Request, env: Env): Promise<Response> {
      const agent = new McpAgent(env);
      return agent.handleRequest(request);
    }
  };
}