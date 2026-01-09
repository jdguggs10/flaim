
export interface Env {
  NODE_ENV?: string;
  ENVIRONMENT?: string;
  AUTH_WORKER_URL: string;
  AUTH_WORKER?: Fetcher;  // Service Binding for auth-worker
}

/**
 * Fetch from auth-worker using service binding (preferred) or URL fallback.
 */
function authWorkerFetch(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const safePath = path.startsWith('/') ? path : `/${path}`;
  if (env.AUTH_WORKER) {
    const url = new URL(safePath, 'https://auth-worker.internal');
    return env.AUTH_WORKER.fetch(new Request(url.toString(), init));
  }
  if (env.ENVIRONMENT === 'prod') {
    console.warn('[agent/authWorkerFetch] AUTH_WORKER binding missing in prod; using URL fallback');
  }
  if (!env.AUTH_WORKER_URL) {
    throw new Error('AUTH_WORKER_URL is not configured');
  }
  return fetch(`${env.AUTH_WORKER_URL}${safePath}`, init);
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

/**
 * Get the default season year for baseball using America/New_York timezone.
 * Defaults to previous year until Feb 1, then switches to current year.
 */
function getDefaultBaseballSeason(now = new Date()): number {
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = Number(ny.find((p) => p.type === 'year')?.value);
  const month = Number(ny.find((p) => p.type === 'month')?.value);

  // Rollover on Feb 1 (month 2)
  return month < 2 ? year - 1 : year;
}

export interface McpToolCall {
  tool: string;
  arguments: Record<string, any>;
}

export interface McpResponse {
  content: any;
  isError?: boolean;
  authError?: boolean; // Indicates token is invalid/expired, should trigger re-auth
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

// User league data from auth-worker
interface UserLeague {
  leagueId: string;
  sport: string;
  teamId?: string;
  seasonYear?: number;
  leagueName?: string;
  teamName?: string;
  isDefault?: boolean;
}

/**
 * Fetch user's configured leagues from auth-worker
 */
async function fetchUserLeagues(
  env: Env,
  clerkUserId: string,
  authHeader?: string | null
): Promise<{ leagues: UserLeague[], error?: string, status?: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

  try {
    console.log(`⚾️ [agent] Fetching leagues for ${clerkUserId}`);

    const response = await authWorkerFetch(env, '/leagues', {
      method: 'GET',
      headers: {
        'X-Clerk-User-ID': clerkUserId,
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {})
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`❌ [agent] Leagues fetch failed: ${response.status}`);
      const text = await response.text().catch(() => 'no body');
      return {
        leagues: [],
        error: `Auth-worker returned ${response.status}: ${text}`,
        status: response.status
      };
    }

    const data = await response.json() as { success?: boolean; leagues?: UserLeague[] };
    const leagues = data.leagues || [];
    console.log(`✅ [agent] Found ${leagues.length} leagues`);
    return { leagues };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('❌ [agent] Failed to fetch leagues:', error);
    return {
      leagues: [],
      error: (error as any).name === 'AbortError'
        ? 'Fetch timed out after 5 seconds'
        : `Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

export class McpAgent {
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
      console.log(`[MCP Baseball Auth] User ID header: ${clerkUserIdHeader ? 'present' : 'MISSING'}, Auth header: ${authHeader ? 'present' : 'MISSING'}, Resolved userId: ${clerkUserId}`);

      const url = new URL(request.url);

      // Strip /baseball prefix if present (custom domain routing)
      let pathname = url.pathname;
      if (pathname.startsWith('/baseball')) {
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

  /**
   * Handle JSON-RPC 2.0 requests (MCP Streamable HTTP transport)
   * This is the protocol OpenAI's Responses API uses for MCP tools
   */
  private async handleJsonRpc(request: Request, clerkUserId: string, corsHeaders: Record<string, string>, env: Env): Promise<Response> {
    // GET requests return server info (for discovery)
    if (request.method === 'GET') {
      return new Response(JSON.stringify({
        name: 'fantasy-baseball-mcp',
        version: '4.0.0',
        description: 'ESPN Fantasy Baseball MCP Server',
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
      console.log(`[MCP] JSON-RPC request: method=${rpcRequest.method}, id=${rpcRequest.id}`);
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
          message: 'Authentication required. Please authorize via OAuth.',
          // OpenAI ChatGPT requires _meta["mcp/www_authenticate"] to trigger OAuth UI
          _meta: {
            'mcp/www_authenticate': [
              'Bearer resource_metadata="https://api.flaim.app/baseball/.well-known/oauth-protected-resource", error="unauthorized", error_description="Authentication required"'
            ]
          }
        },
        id: rpcRequest.id ?? null
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer resource_metadata="https://api.flaim.app/baseball/.well-known/oauth-protected-resource"',
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
        name: 'fantasy-baseball-mcp',
        version: '4.0.0'
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

      // Check for auth error - return 401 to trigger re-auth in ChatGPT
      if (result.authError) {
        logTool({
          request_id: requestId,
          user_id: logUserId,
          tool_name: toolName,
          status: 'error',
          error_code: 'AUTH_FAILED',
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });

        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Authentication failed. Please re-authorize via OAuth.',
            _meta: {
              'mcp/www_authenticate': [
                'Bearer resource_metadata="https://api.flaim.app/baseball/.well-known/oauth-protected-resource", error="invalid_token", error_description="Token is invalid or expired"'
              ]
            }
          },
          id: rpcRequest.id ?? null
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer resource_metadata="https://api.flaim.app/baseball/.well-known/oauth-protected-resource", error="invalid_token"',
            ...corsHeaders
          }
        });
      }

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
    const currentYear = getDefaultBaseballSeason().toString();
    const currentDate = new Date().toISOString().split('T')[0];

    // securitySchemes required by OpenAI ChatGPT for OAuth-protected tools
    const securitySchemes = [{ type: 'oauth2', scopes: ['mcp:read'] }];

    return [
      {
        name: 'get_user_session',
        description: 'IMPORTANT: Call this tool FIRST before any other tool. Returns the user\'s configured ESPN leagues, team IDs, current date/time, and current season. Use the returned leagueId and teamId values for all subsequent tool calls.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        },
        securitySchemes
      },
      {
        name: 'get_espn_baseball_league_info',
        description: `Get ESPN fantasy baseball league information. Use leagueId from get_user_session. Current season is ${currentYear}.`,
        inputSchema: {
          type: 'object',
          properties: {
            leagueId: {
              type: 'string',
              description: 'ESPN league ID (get from get_user_session)'
            },
            seasonId: {
              type: 'string',
              description: `Season year (default: ${currentYear})`,
              default: currentYear
            }
          },
          required: ['leagueId']
        },
        securitySchemes
      },
      {
        name: 'get_espn_baseball_team_roster',
        description: `Get detailed team roster from ESPN fantasy baseball league. Use leagueId and teamId from get_user_session. Current season is ${currentYear}.`,
        inputSchema: {
          type: 'object',
          properties: {
            leagueId: { type: 'string', description: 'ESPN league ID (get from get_user_session)' },
            teamId: { type: 'string', description: 'Team ID within the league (get from get_user_session)' },
            seasonId: { type: 'string', description: `Season year (default: ${currentYear})`, default: currentYear }
          },
          required: ['leagueId', 'teamId']
        },
        securitySchemes
      },
      {
        name: 'get_espn_baseball_matchups',
        description: `Get current week matchups from ESPN fantasy baseball league. Use leagueId from get_user_session. Current season is ${currentYear}, current date is ${currentDate}.`,
        inputSchema: {
          type: 'object',
          properties: {
            leagueId: { type: 'string', description: 'ESPN league ID (get from get_user_session)' },
            week: { type: 'number', description: 'Week number (optional, defaults to current week)' },
            seasonId: { type: 'string', description: `Season year (default: ${currentYear})`, default: currentYear }
          },
          required: ['leagueId']
        },
        securitySchemes
      },
      {
        name: 'get_espn_baseball_standings',
        description: `Get league standings from ESPN fantasy baseball league. Use leagueId from get_user_session. Current season is ${currentYear}.`,
        inputSchema: {
          type: 'object',
          properties: {
            leagueId: { type: 'string', description: 'ESPN league ID (get from get_user_session)' },
            seasonId: { type: 'string', description: `Season year (default: ${currentYear})`, default: currentYear }
          },
          required: ['leagueId']
        },
        securitySchemes
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

  private async executeTool(
    tool: string,
    args: Record<string, any>,
    clerkUserId: string,
    env: Env,
    authHeader?: string | null,
    logContext?: { resolvedUserId?: string }
  ): Promise<McpResponse> {
    // Fetch user's configured leagues to validate/override leagueId
    const { leagues: userLeagues, error: fetchError, status: fetchStatus } = await fetchUserLeagues(env, clerkUserId, authHeader);

    // Check for auth errors (invalid/expired token) - trigger re-auth flow
    if (fetchStatus === 401 || fetchStatus === 403) {
      console.log(`🔒 [agent] Auth error from auth-worker: status=${fetchStatus}`);
      return {
        content: 'Authentication failed. Please re-authorize.',
        isError: true,
        authError: true // Signal to return 401 with _meta
      };
    }

    // Normalize sport filtering: case-insensitive
    const baseballLeagues = userLeagues.filter((l: any) =>
      l.sport?.toLowerCase() === 'baseball' || l.sport?.toLowerCase() === 'mlb'
    );

    // Check if we found ANY leagues
    const hasAnyLeagues = userLeagues.length > 0;
    const hasBaseballLeagues = baseballLeagues.length > 0;

    console.log(`📋 [agent] executeTool: total leagues=${userLeagues.length}, baseball leagues=${baseballLeagues.length}`);

    // SPECIAL CASE: get_user_session should always work if authenticated
    if (tool === 'get_user_session') {
      const hasMultipleLeagues = baseballLeagues.length > 1;
      // Check if any leagues have different seasons (multi-season scenario)
      const uniqueSeasons = [...new Set((baseballLeagues as any[]).map(l => l.seasonYear).filter(Boolean))];
      const hasMultipleSeasons = uniqueSeasons.length > 1;

      let sessionMessage: string;
      if (!hasBaseballLeagues) {
        sessionMessage = hasAnyLeagues
          ? `No baseball leagues found, but found leagues for: ${userLeagues.map(l => l.sport).join(', ')}. Please add a baseball league in settings.`
          : 'No leagues configured. Please go to flaim.app/settings/espn to add your ESPN credentials.';
      } else if (hasMultipleLeagues) {
        sessionMessage = hasMultipleSeasons
          ? `User has ${baseballLeagues.length} baseball league entries across seasons ${uniqueSeasons.join(', ')}. ASK which league AND season they want. List by leagueName, leagueId, AND seasonYear. Use matching teamId and seasonYear together.`
          : `User has ${baseballLeagues.length} baseball leagues configured. ASK which league they want. List by leagueName and leagueId.`;
      } else {
        // Single league - use it directly with its seasonYear
        const league = baseballLeagues[0] as any;
        sessionMessage = league.seasonYear
          ? `Use leagueId=${league.leagueId}, teamId=${league.teamId || 'none'}, seasonId=${league.seasonYear} for all tool calls.`
          : 'Use defaultLeague.leagueId and defaultLeague.teamId for all subsequent tool calls. Use currentSeason for seasonId parameter.';
      }

      // Build defaultLeague with seasonYear for LLM convenience
      const currentSeason = getDefaultBaseballSeason();
      const currentSeasonLeague = (baseballLeagues as any[]).find(
        l => l.teamId && l.seasonYear === currentSeason
      );
      const anyLeagueWithTeam = (baseballLeagues as any[]).find(l => l.teamId);
      const defaultLeagueData = currentSeasonLeague || anyLeagueWithTeam || baseballLeagues[0];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              currentDate: new Date().toISOString(),
              currentSeason: currentSeason.toString(),
              timezone: 'America/New_York',
              totalLeaguesFound: userLeagues.length,
              baseballLeaguesFound: baseballLeagues.length,
              defaultLeague: defaultLeagueData ? {
                leagueId: defaultLeagueData.leagueId,
                teamId: defaultLeagueData.teamId,
                seasonYear: defaultLeagueData.seasonYear,
                leagueName: defaultLeagueData.leagueName,
                teamName: defaultLeagueData.teamName
              } : null,
              allLeagues: userLeagues,
              instructions: sessionMessage,
              debug: {
                clerkUserId: clerkUserId === 'oauth-user' ? 'oauth-user' : `${clerkUserId.substring(0, 8)}...`,
                hasAuthHeader: !!authHeader,
                fetchStatus
              }
            }, null, 2)
          }
        ]
      };
    }

    // For other tools: If no baseball leagues configured, return error
    if (!hasBaseballLeagues) {
      let message = 'No baseball leagues configured. Please go to flaim.app/settings/espn to add your ESPN credentials and select a league.';
      if (fetchError) {
        console.error(`❌ [agent] Fetch leagues error (status ${fetchStatus}): ${fetchError}`);
        message = `Unable to fetch your leagues: ${fetchError}`;
      } else if (hasAnyLeagues) {
        const sports = [...new Set(userLeagues.map((l: any) => l.sport))].join(', ');
        message = `No baseball leagues found, but found leagues for: ${sports}. Please add a baseball league in settings.`;
      }

      return {
        content: message,
        isError: true
      };
    }

    // Use the first baseball league as default (or find one with teamId set)
    // Prefer leagues matching the current season to avoid season/team mismatch
    const currentSeason = getDefaultBaseballSeason();
    const currentSeasonLeague = (baseballLeagues as any).find(
      (l: any) => l.teamId && l.seasonYear === currentSeason
    );
    const anyLeagueWithTeam = (baseballLeagues as any).find((l: any) => l.teamId);
    const defaultLeague = currentSeasonLeague || anyLeagueWithTeam || baseballLeagues[0];

    // Normalize args: use user's configured league if not provided or invalid
    const normalizedArgs = { ...args };

    // Override leagueId if not provided or if it doesn't match user's leagues
    const providedLeagueId = args.leagueId?.toString();
    const userHasLeague = providedLeagueId && (baseballLeagues as any).some((l: any) => l.leagueId === providedLeagueId);

    if (!providedLeagueId || !userHasLeague) {
      console.log(`📋 [agent] Using default league ${defaultLeague.leagueId} season ${defaultLeague.seasonYear} (provided: ${providedLeagueId || 'none'}, valid: ${userHasLeague})`);
      normalizedArgs.leagueId = defaultLeague.leagueId;
      if (defaultLeague.teamId) {
        normalizedArgs.teamId = normalizedArgs.teamId || defaultLeague.teamId;
      }
      // Use the league's seasonYear to keep team/season aligned
      if (defaultLeague.seasonYear && !normalizedArgs.seasonId) {
        normalizedArgs.seasonId = defaultLeague.seasonYear.toString();
      }
    } else if (!normalizedArgs.seasonId) {
      // User provided valid leagueId but no seasonId - find the matching league's seasonYear
      const matchingLeague = (baseballLeagues as any[]).find(l => l.leagueId === providedLeagueId);
      if (matchingLeague?.seasonYear) {
        console.log(`📋 [agent] Using stored seasonYear ${matchingLeague.seasonYear} for provided league ${providedLeagueId}`);
        normalizedArgs.seasonId = matchingLeague.seasonYear.toString();
      }
    }

    // Default seasonId to timezone-aware current season if still not set
    if (!normalizedArgs.seasonId) {
      normalizedArgs.seasonId = currentSeason.toString();
    }

    console.log(`🔧 [agent] Executing ${tool} with normalized args:`, JSON.stringify(normalizedArgs));

    switch (tool) {
      case 'get_espn_baseball_league_info':
        return this.getEspnLeagueInfo(normalizedArgs, clerkUserId, env, authHeader, logContext);

      case 'get_espn_baseball_team_roster':
        return this.getEspnTeamRoster(normalizedArgs, clerkUserId, env, authHeader, logContext);

      case 'get_espn_baseball_matchups':
        return this.getEspnMatchups(normalizedArgs, clerkUserId, env, authHeader, logContext);

      case 'get_espn_baseball_standings':
        return this.getEspnBaseballStandings(normalizedArgs, clerkUserId, env, authHeader, logContext);

      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async getEspnLeagueInfo(
    args: Record<string, any>,
    clerkUserId: string,
    env: Env,
    authHeader?: string | null,
    logContext?: { resolvedUserId?: string }
  ): Promise<McpResponse> {
    try {
      const { EspnApiClient } = await import('../espn');
      const espnClient = new EspnApiClient(env, { authHeader, logContext });

      const { leagueId, seasonId = getDefaultBaseballSeason().toString() } = args;
      const league = await espnClient.fetchLeague(leagueId, parseInt(seasonId), 'mSettings', clerkUserId);

      const { getLeagueMeta } = await import('../tools/getLeagueMeta');
      const metadata = await getLeagueMeta(
        { leagueId: league.id.toString(), year: league.seasonId },
        env
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              data: metadata,
              leagueId,
              year: parseInt(seasonId)
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to fetch league info: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  }

  private async getEspnTeamRoster(
    args: Record<string, any>,
    clerkUserId: string,
    env: Env,
    authHeader?: string | null,
    logContext?: { resolvedUserId?: string }
  ): Promise<McpResponse> {
    try {
      const { EspnApiClient } = await import('../espn');
      const espnClient = new EspnApiClient(env, { authHeader, logContext });

      const { leagueId, teamId, seasonId = getDefaultBaseballSeason().toString() } = args;
      const roster = await espnClient.fetchRoster(leagueId, teamId, parseInt(seasonId), undefined, clerkUserId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              data: roster,
              leagueId,
              teamId,
              year: parseInt(seasonId)
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to fetch team roster: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  }

  private async getEspnMatchups(
    args: Record<string, any>,
    clerkUserId: string,
    env: Env,
    authHeader?: string | null,
    logContext?: { resolvedUserId?: string }
  ): Promise<McpResponse> {
    try {
      const { EspnApiClient } = await import('../espn');
      const espnClient = new EspnApiClient(env, { authHeader, logContext });

      const { leagueId, week, seasonId = getDefaultBaseballSeason().toString() } = args;
      const league = await espnClient.fetchLeague(leagueId, parseInt(seasonId), 'mMatchup', clerkUserId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              data: league,
              leagueId,
              week,
              year: parseInt(seasonId)
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to fetch matchups: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  }

  private async getEspnBaseballStandings(
    args: Record<string, any>,
    clerkUserId: string,
    env: Env,
    authHeader?: string | null,
    logContext?: { resolvedUserId?: string }
  ): Promise<McpResponse> {
    try {
      const { EspnApiClient } = await import('../espn');
      const espnClient = new EspnApiClient(env, { authHeader, logContext });

      const { leagueId, seasonId = getDefaultBaseballSeason().toString() } = args;
      const standings = await espnClient.fetchStandings(leagueId, parseInt(seasonId), clerkUserId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              data: standings,
              leagueId,
              year: parseInt(seasonId)
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to fetch baseball standings: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        ],
        isError: true
      };
    }
  }

}
