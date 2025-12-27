import { EspnFootballApiClient } from '../espn-football-client';

export interface Env {
  NODE_ENV?: string;
  CLERK_SECRET_KEY?: string;
  AUTH_WORKER_URL: string;
}

// =============================================================================
// STRUCTURED LOGGING
// =============================================================================

interface ToolLog {
  request_id: string;
  user_id: string;
  tool_name: string;
  status: 'start' | 'success' | 'error';
  error_code?: string;
  duration_ms?: number;
  timestamp: string;
}

function logTool(log: ToolLog): void {
  console.log(JSON.stringify(log));
}

function maskUserId(userId: string | null): string {
  if (!userId || userId.length <= 8) return 'anonymous';
  return `${userId.substring(0, 8)}...`;
}

function extractErrorCode(message: string): string | undefined {
  // Extract error code prefix like "ESPN_COOKIES_EXPIRED" from error messages
  const match = message.match(/^([A-Z_]+):/);
  return match ? match[1] : undefined;
}

export interface McpToolCall {
  tool: string;
  arguments: Record<string, any>;
}

export interface McpResponse {
  content: any;
  isError?: boolean;
}

// JSON-RPC 2.0 types for MCP protocol
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, any>;
  id?: string | number | null;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number | null;
}

export class FootballMcpAgent {
  constructor() { }

  async handleRequest(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-ID',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Extract Clerk user ID from headers (preferred) or fallback to anonymous
      // For OAuth (Claude direct access), there's no X-Clerk-User-ID header,
      // so we use 'oauth-user' as placeholder - auth-worker will validate the token
      // and return the real user ID.
      const clerkUserIdHeader = request.headers.get('X-Clerk-User-ID');
      const authHeader = request.headers.get('Authorization');
      let clerkUserId = clerkUserIdHeader ||
        new URL(request.url).searchParams.get('clerkUserId') ||
        'anonymous';

      // If we have an auth header but no user ID, this is likely an OAuth request
      // Use 'oauth-user' placeholder - auth-worker validates the token
      if (clerkUserId === 'anonymous' && authHeader) {
        clerkUserId = 'oauth-user';
      }

      // Debug logging for auth issues
      console.log(`[MCP Football Auth] User ID header: ${clerkUserIdHeader ? 'present' : 'MISSING'}, Auth header: ${authHeader ? 'present' : 'MISSING'}, Resolved userId: ${clerkUserId}`);

      const url = new URL(request.url);

      // Strip /football prefix if present (custom domain routing)
      let pathname = url.pathname;
      if (pathname.startsWith('/football')) {
        pathname = pathname.slice(9) || '/';
      }

      // Legacy REST endpoints (for backwards compatibility with direct testing)
      if (pathname === '/mcp/tools/list') {
        return this.handleToolsListLegacy(clerkUserId, corsHeaders);
      }

      if (pathname === '/mcp/tools/call') {
        return this.handleToolCallLegacy(request, clerkUserId, corsHeaders, env);
      }

      // Main MCP endpoint - handles JSON-RPC 2.0 protocol (required by OpenAI)
      if (pathname === '/mcp') {
        return this.handleJsonRpc(request, clerkUserId, corsHeaders, env);
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

  /**
   * Handle JSON-RPC 2.0 requests (MCP Streamable HTTP transport)
   * This is the protocol OpenAI's Responses API uses for MCP tools
   */
  private async handleJsonRpc(request: Request, clerkUserId: string, corsHeaders: Record<string, string>, env: Env): Promise<Response> {
    // GET requests return server info (for discovery)
    if (request.method === 'GET') {
      return new Response(JSON.stringify({
        name: 'fantasy-football-mcp',
        version: '1.0.0',
        description: 'ESPN Fantasy Football MCP Server',
        capabilities: {
          tools: true,
          resources: false,
          prompts: false
        }
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // POST requests are JSON-RPC 2.0
    let rpcRequest: JsonRpcRequest;
    try {
      const payload = await request.json() as Record<string, unknown>;
      // Validate payload structure before type assertion
      if (!payload || typeof payload !== 'object' || typeof payload.method !== 'string') {
        return this.jsonRpcError(-32600, 'Invalid Request: Malformed request payload', (payload?.id as string | number | null) ?? null, corsHeaders);
      }
      rpcRequest = payload as unknown as JsonRpcRequest;
      console.log(`[MCP Football] JSON-RPC request: method=${rpcRequest.method}, id=${rpcRequest.id}`);
    } catch (e) {
      return this.jsonRpcError(-32700, 'Parse error: Invalid JSON', null, corsHeaders);
    }

    // Validate JSON-RPC format
    if (rpcRequest.jsonrpc !== '2.0') {
      return this.jsonRpcError(-32600, 'Invalid Request: jsonrpc must be "2.0"', rpcRequest.id ?? null, corsHeaders);
    }

    const authHeader = request.headers.get('Authorization');

    // Require authentication for all MCP operations - return 401 to trigger OAuth on connect
    // This follows MCP spec: "When an MCP client attempts to connect to a protected MCP server,
    // the server will initially respond with a 401 Unauthorized status."
    if (!authHeader) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Authentication required. Please authorize via OAuth.'
        },
        id: rpcRequest.id ?? null
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer resource_metadata="https://api.flaim.app/auth/.well-known/oauth-authorization-server"',
          ...corsHeaders
        }
      });
    }

    // Route to appropriate handler based on method
    switch (rpcRequest.method) {
      case 'initialize':
        return this.handleInitialize(rpcRequest, corsHeaders);

      case 'tools/list':
        return this.handleToolsList(rpcRequest, corsHeaders);

      case 'tools/call':
        return this.handleToolsCall(rpcRequest, clerkUserId, env, authHeader, corsHeaders);

      case 'ping':
        return this.jsonRpcSuccess({}, rpcRequest.id ?? null, corsHeaders);

      default:
        return this.jsonRpcError(-32601, `Method not found: ${rpcRequest.method}`, rpcRequest.id ?? null, corsHeaders);
    }
  }

  /**
   * Handle MCP initialize request
   */
  private handleInitialize(rpcRequest: JsonRpcRequest, corsHeaders: Record<string, string>): Response {
    const result = {
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'fantasy-football-mcp',
        version: '1.0.0'
      },
      capabilities: {
        tools: {}
      }
    };
    return this.jsonRpcSuccess(result, rpcRequest.id ?? null, corsHeaders);
  }

  /**
   * Handle tools/list JSON-RPC method
   */
  private handleToolsList(rpcRequest: JsonRpcRequest, corsHeaders: Record<string, string>): Response {
    const tools = this.getToolDefinitions();
    return this.jsonRpcSuccess({ tools }, rpcRequest.id ?? null, corsHeaders);
  }

  /**
   * Handle tools/call JSON-RPC method
   */
  private async handleToolsCall(
    rpcRequest: JsonRpcRequest,
    clerkUserId: string,
    env: Env,
    authHeader: string | null,
    corsHeaders: Record<string, string>
  ): Promise<Response> {
    const params = rpcRequest.params || {};
    const toolName = params.name;
    const toolArgs = params.arguments || {};

    // Validate tool name is a non-empty string
    if (typeof toolName !== 'string' || !toolName) {
      return this.jsonRpcError(-32602, 'Invalid params: missing or invalid tool name', rpcRequest.id ?? null, corsHeaders);
    }

    // Validate arguments is an object (not array, null, or primitive)
    if (typeof toolArgs !== 'object' || toolArgs === null || Array.isArray(toolArgs)) {
      return this.jsonRpcError(-32602, 'Invalid params: "arguments" must be an object', rpcRequest.id ?? null, corsHeaders);
    }

    // Structured logging setup
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    const maskedUserId = maskUserId(clerkUserId);
    const logContext: { resolvedUserId?: string } = {};

    // Log tool execution start
    logTool({
      request_id: requestId,
      user_id: maskedUserId,
      tool_name: toolName,
      status: 'start',
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await this.executeTool(toolName, toolArgs, clerkUserId, env, authHeader, logContext);
      const resolvedUserId = logContext.resolvedUserId;
      const logUserId = maskUserId(resolvedUserId ?? clerkUserId);

      // Log tool execution success
      logTool({
        request_id: requestId,
        user_id: logUserId,
        tool_name: toolName,
        status: 'success',
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });

      // MCP tools/call response format
      const callResult = {
        content: [
          {
            type: 'text',
            text: typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
          }
        ],
        isError: result.isError || false
      };

      return this.jsonRpcSuccess(callResult, rpcRequest.id ?? null, corsHeaders);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = extractErrorCode(errorMessage);
      const resolvedUserId = logContext.resolvedUserId;
      const logUserId = maskUserId(resolvedUserId ?? clerkUserId);

      // Log tool execution error
      logTool({
        request_id: requestId,
        user_id: logUserId,
        tool_name: toolName,
        status: 'error',
        error_code: errorCode,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });

      // Return error as tool result (not JSON-RPC error) so OpenAI can handle it gracefully
      const errorResult = {
        content: [
          {
            type: 'text',
            text: `Tool execution failed: ${errorMessage}`
          }
        ],
        isError: true
      };

      return this.jsonRpcSuccess(errorResult, rpcRequest.id ?? null, corsHeaders);
    }
  }

  /**
   * Create a JSON-RPC 2.0 success response
   */
  private jsonRpcSuccess(result: any, id: string | number | null, corsHeaders: Record<string, string>): Response {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      result,
      id
    };
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  /**
   * Create a JSON-RPC 2.0 error response
   */
  private jsonRpcError(code: number, message: string, id: string | number | null, corsHeaders: Record<string, string>): Response {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      error: { code, message },
      id
    };
    return new Response(JSON.stringify(response), {
      status: 200, // JSON-RPC errors still return 200 HTTP status
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  /**
   * Get tool definitions in MCP format
   */
  private getToolDefinitions() {
    return [
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
  }

  /**
   * Legacy REST endpoint for tools list (backwards compatibility with curl testing)
   */
  private handleToolsListLegacy(_clerkUserId: string, corsHeaders: Record<string, string>): Response {
    const tools = this.getToolDefinitions();
    return new Response(JSON.stringify({ tools }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  /**
   * Legacy REST endpoint for tool calls (backwards compatibility)
   */
  private async handleToolCallLegacy(request: Request, clerkUserId: string, corsHeaders: Record<string, string>, env: Env): Promise<Response> {
    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ content: 'Invalid JSON in request body', isError: true }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Validate body structure
    if (typeof body !== 'object' || body === null || typeof (body as any).tool !== 'string') {
      return new Response(JSON.stringify({ content: 'Invalid request body: missing or invalid "tool" field', isError: true }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const { tool, arguments: args } = body as McpToolCall;

    // Validate arguments if provided
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
      return new Response(JSON.stringify({ content: 'Invalid arguments: must be an object', isError: true }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      const authHeader = request.headers.get('Authorization');
      const result = await this.executeTool(tool, args || {}, clerkUserId, env, authHeader);

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

  private async executeTool(
    tool: string,
    args: Record<string, any>,
    clerkUserId: string,
    env: Env,
    authHeader?: string | null,
    logContext?: { resolvedUserId?: string }
  ): Promise<McpResponse> {
    switch (tool) {
      case 'get_espn_football_league_info':
        return this.getEspnFootballLeagueInfo(args, clerkUserId, env, authHeader, logContext);

      case 'get_espn_football_team':
        return this.getEspnFootballTeam(args, clerkUserId, env, authHeader, logContext);

      case 'get_espn_football_matchups':
        return this.getEspnFootballMatchups(args, clerkUserId, env, authHeader, logContext);

      case 'get_espn_football_standings':
        return this.getEspnFootballStandings(args, clerkUserId, env, authHeader, logContext);

      default:
        throw new Error(`Unknown football tool: ${tool}`);
    }
  }

  private async getEspnFootballLeagueInfo(
    args: Record<string, any>,
    clerkUserId: string,
    env: Env,
    authHeader?: string | null,
    logContext?: { resolvedUserId?: string }
  ): Promise<McpResponse> {
    try {
      const footballClient = new EspnFootballApiClient(env, { authHeader, logContext });

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

  private async getEspnFootballTeam(
    args: Record<string, any>,
    clerkUserId: string,
    env: Env,
    authHeader?: string | null,
    logContext?: { resolvedUserId?: string }
  ): Promise<McpResponse> {
    try {
      const footballClient = new EspnFootballApiClient(env, { authHeader, logContext });

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

  private async getEspnFootballMatchups(
    args: Record<string, any>,
    clerkUserId: string,
    env: Env,
    authHeader?: string | null,
    logContext?: { resolvedUserId?: string }
  ): Promise<McpResponse> {
    try {
      const footballClient = new EspnFootballApiClient(env, { authHeader, logContext });

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

  private async getEspnFootballStandings(
    args: Record<string, any>,
    clerkUserId: string,
    env: Env,
    authHeader?: string | null,
    logContext?: { resolvedUserId?: string }
  ): Promise<McpResponse> {
    try {
      const footballClient = new EspnFootballApiClient(env, { authHeader, logContext });

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
