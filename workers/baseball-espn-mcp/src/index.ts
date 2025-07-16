// Baseball ESPN MCP Server v4.0 - Open Access
// Focuses purely on ESPN API integration with KV storage

import { McpAgent } from './mcp/agent.js';
import { getCredentials, getUserLeagues } from '../../../auth/dist/shared/shared/auth-worker-client.js';
import { getBasicLeagueInfo } from './mcp/basic-league-info.js';

export interface Env {
  CF_KV_CREDENTIALS: KVNamespace;
  CF_ENCRYPTION_KEY: string;
  ESPN_S2?: string;
  ESPN_SWID?: string;
  NODE_ENV?: string;
  ENVIRONMENT?: string;
  CLERK_SECRET_KEY?: string;
  AUTH_WORKER_URL?: string;
}

// Helper function for CORS headers
const ALLOWED_ORIGINS = [
  'https://preview.flaim-frontend.pages.dev',      // Remote preview (primary)
  'https://preview.flaim.pages.dev',               // Legacy preview subdomain
  'https://flaim.app',                             // Production
  'http://localhost:8787',                         // Wrangler dev server (HTTP)
  'https://localhost:8787',                        // Wrangler dev server (HTTPS)
  'http://localhost:3000'                          // Next.js dev server
];

function getCorsHeaders(request: Request) {
  const origin = request.headers.get('Origin');
  const headers: { [key: string]: string } = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-ID',
  };

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check endpoint with KV connectivity test
      if (url.pathname === '/health') {
        const healthData: any = {
          status: 'healthy', 
          service: 'baseball-espn-mcp',
          version: '4.0.0',
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

      // Onboarding initialize endpoint
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

          console.log(`🚀 Initialize onboarding for user: ${clerkUserId}, sport: ${sport}, leagueId: ${leagueId}`);

          // Get credentials from auth-worker
          const authWorkerConfig = {
            authWorkerUrl: env.AUTH_WORKER_URL,
            defaultUrl: env.AUTH_WORKER_URL
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
          const baseballLeagues = leagues.filter((league: { leagueId: string; sport: string; teamId?: string }) => league.sport === 'baseball');

          if (baseballLeagues.length === 0) {
            return new Response(JSON.stringify({
              error: 'No baseball leagues found. Please add baseball leagues first.',
              code: 'LEAGUES_MISSING'
            }), {
              status: 404,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          // Filter to specific league if leagueId provided
          let targetLeagues = baseballLeagues;
          if (leagueId) {
            targetLeagues = baseballLeagues.filter((league: { leagueId: string; sport: string; teamId?: string }) => league.leagueId === leagueId);
            
            if (targetLeagues.length === 0) {
              return new Response(JSON.stringify({
                error: `Baseball league ${leagueId} not found for user.`,
                code: 'LEAGUE_NOT_FOUND'
              }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
              });
            }
          }

          console.log(`🏈 Found ${targetLeagues.length} baseball leagues for user`);

          // Fetch basic info for the target league(s)
          const leagueResults = [];
          for (const league of targetLeagues) {
            try {
              const basicInfo = await getBasicLeagueInfo({
                leagueId: league.leagueId,
                sport: league.sport,
                gameId: 'flb', // ESPN Fantasy Baseball game ID
                credentials
              });

              leagueResults.push({
                leagueId: league.leagueId,
                sport: league.sport,
                teamId: league.teamId,
                ...basicInfo
              });
            } catch (error) {
              console.error(`❌ Failed to get info for league ${league.leagueId}:`, error);
              leagueResults.push({
                leagueId: league.leagueId,
                sport: league.sport,
                teamId: league.teamId,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          }

          return new Response(JSON.stringify({
            success: true,
            message: 'Onboarding initialized successfully',
            sport: 'baseball',
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
        const agent = new McpAgent();
        return await agent.handleRequest(request, env);
      }

      // 404 for unknown endpoints
      return new Response(JSON.stringify({
        error: 'Endpoint not found',
        message: 'Available endpoints',
        endpoints: {
          '/health': 'GET - Health check with KV connectivity test',
          '/onboarding/initialize': 'POST - Initialize onboarding with league data fetching (requires X-Clerk-User-ID header)',
          '/mcp': 'POST - MCP protocol endpoints for Claude integration'
        },
        version: '4.0.0'
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