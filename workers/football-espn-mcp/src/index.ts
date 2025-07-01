// Football ESPN MCP Server v1.0 - Open Access
// Focuses on ESPN Fantasy Football API integration with KV storage

import { FootballMcpAgent } from './mcp/football-agent.js';
import { getCredentials, getUserLeagues } from './utils/auth-worker.js';
import { getBasicLeagueInfo } from './mcp/basic-league-info.js';

export interface Env {
  CF_KV_CREDENTIALS: KVNamespace;
  CF_ENCRYPTION_KEY: string;
  ESPN_S2?: string;
  ESPN_SWID?: string;
  NODE_ENV?: string;
  CLERK_SECRET_KEY?: string;
  AUTH_WORKER_URL?: string;
}

// Helper function for CORS headers
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-ID',
  };
}

// ESPN sport to game ID mapping
function getEspnGameId(sport: string): string {
  const sportMap: Record<string, string> = {
    'football': 'ffl',  // Fantasy Football League
    'basketball': 'fba', // Fantasy Basketball
    'hockey': 'fhl',     // Fantasy Hockey League  
    'baseball': 'flb',   // Fantasy Baseball (corrected)
    'soccer': 'fs'       // Fantasy Soccer (if supported)
  };
  
  return sportMap[sport.toLowerCase()] || 'ffl'; // Default to football
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders();

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check endpoint with KV connectivity test
      if (url.pathname === '/health') {
        const healthData: any = {
          status: 'healthy', 
          service: 'football-espn-mcp',
          version: '1.0.0',
          timestamp: new Date().toISOString()
        };

        // Test KV connectivity (still needed for reading credentials from auth-worker)
        try {
          if (env.CF_KV_CREDENTIALS) {
            // Try a simple KV operation to verify connectivity
            await env.CF_KV_CREDENTIALS.get('__health_check__');
            healthData.kv_status = 'connected';
          } else {
            healthData.kv_status = 'not_configured';
            healthData.status = 'degraded';
          }
        } catch (error) {
          healthData.kv_status = 'error';
          healthData.kv_error = error instanceof Error ? error.message : 'Unknown KV error';
          healthData.status = 'degraded';
        }

        // Note: Credential storage now handled by auth-worker
        healthData.credential_storage = 'handled_by_auth_worker';

        const statusCode = healthData.status === 'healthy' ? 200 : 503;

        return new Response(JSON.stringify(healthData), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Onboarding initialize endpoint - supports multiple sports
      if (url.pathname === '/onboarding/initialize' && request.method === 'POST') {
        try {
          const clerkUserId = request.headers.get('X-Clerk-User-ID');

          if (!clerkUserId) {
            return new Response(JSON.stringify({
              error: 'Authentication required - X-Clerk-User-ID header missing'
            }), {
              status: 401,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          const body = await request.json() as { sport?: string; leagueId?: string };
          const { sport, leagueId } = body;

          const targetSport = sport || 'football'; // Default to football for this worker
          console.log(`🚀 Initialize onboarding for user: ${clerkUserId}, sport: ${targetSport}, leagueId: ${leagueId}`);

          // Get credentials from auth-worker
          const authWorkerConfig = {
            authWorkerUrl: env.AUTH_WORKER_URL,
            defaultUrl: 'http://localhost:8786'
          };

          const credentials = await getCredentials(clerkUserId, authWorkerConfig);
          if (!credentials) {
            return new Response(JSON.stringify({
              error: 'ESPN credentials not found. Please add your ESPN credentials first.',
              code: 'CREDENTIALS_MISSING'
            }), {
              status: 404,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          // Get user's leagues from auth-worker
          const leagues = await getUserLeagues(clerkUserId, authWorkerConfig);
          let targetLeagues = leagues.filter(league => league.sport === targetSport);

          if (targetLeagues.length === 0) {
            return new Response(JSON.stringify({
              error: `No ${targetSport} leagues found. Please add ${targetSport} leagues first.`,
              code: 'LEAGUES_MISSING'
            }), {
              status: 404,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          // Filter to specific league if leagueId provided
          if (leagueId) {
            const filteredLeagues = targetLeagues.filter(league => league.leagueId === leagueId);
            
            if (filteredLeagues.length === 0) {
              return new Response(JSON.stringify({
                error: `${targetSport} league ${leagueId} not found for user.`,
                code: 'LEAGUE_NOT_FOUND'
              }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
              });
            }
            
            targetLeagues = filteredLeagues;
          }

          console.log(`🏈 Found ${targetLeagues.length} ${targetSport} leagues for user`);

          // Fetch basic info for each league
          const leagueResults = [];
          for (const league of targetLeagues) {
            try {
              const gameId = getEspnGameId(league.sport);
              const basicInfo = await getBasicLeagueInfo({
                leagueId: league.leagueId,
                sport: league.sport,
                gameId,
                credentials
              });

              leagueResults.push({
                leagueId: league.leagueId,
                sport: league.sport,
                teamId: league.teamId,
                gameId,
                ...basicInfo
              });
            } catch (error) {
              console.error(`❌ Failed to get info for league ${league.leagueId}:`, error);
              leagueResults.push({
                leagueId: league.leagueId,
                sport: league.sport,
                teamId: league.teamId,
                gameId: getEspnGameId(league.sport),
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          }

          return new Response(JSON.stringify({
            success: true,
            message: 'Onboarding initialized successfully',
            sport: targetSport,
            totalLeagues: targetLeagues.length,
            leagues: leagueResults
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });

        } catch (error) {
          console.error('❌ Onboarding initialize error:', error);
          return new Response(JSON.stringify({
            error: 'Failed to initialize onboarding',
            details: error instanceof Error ? error.message : 'Unknown error'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
      }

      // MCP endpoints - delegate to agent
      if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
        const agent = new FootballMcpAgent();
        return await agent.handleRequest(request, env);
      }

      // 404 for unknown endpoints
      return new Response(JSON.stringify({
        error: 'Endpoint not found',
        message: 'Available endpoints',
        endpoints: {
          '/health': 'GET - Health check with KV connectivity test',
          '/onboarding/initialize': 'POST - Initialize onboarding with multi-sport league data fetching (requires X-Clerk-User-ID header)',
          '/mcp': 'POST - MCP protocol endpoints for Claude integration'
        },
        supportedSports: ['football', 'basketball', 'hockey', 'baseball', 'soccer'],
        version: '1.0.0'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};