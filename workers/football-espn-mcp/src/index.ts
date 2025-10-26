// Football ESPN MCP Server v1.0 - Open Access
// Focuses on ESPN Fantasy Football API integration with auth-worker service

import { FootballMcpAgent } from './mcp/football-agent.js';
import { getBasicLeagueInfo } from './mcp/basic-league-info.js';

export interface Env {
  NODE_ENV?: string;
  ENVIRONMENT?: string;
  CLERK_SECRET_KEY?: string;
  AUTH_WORKER_URL: string;
}

// ESPN Credentials interface
export interface EspnCredentials {
  swid: string;
  s2: string;
  email?: string;
}

// Auth Worker Config interface
export interface AuthWorkerConfig {
  authWorkerUrl?: string;
  defaultUrl?: string;
}

/**
 * Fetch ESPN credentials from auth-worker for a given Clerk user ID
 */
async function getCredentials(
  clerkUserId: string,
  config: AuthWorkerConfig = {},
  authHeader?: string | null
): Promise<EspnCredentials | null> {
  try {
    const authWorkerUrl = config.authWorkerUrl || config.defaultUrl;
    const url = `${authWorkerUrl}/credentials/espn?raw=true`;
    
    console.log(`🔑 Fetching ESPN credentials for user ${clerkUserId} from ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Clerk-User-ID': clerkUserId,
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {})
      }
    });
    
    console.log(`📡 Auth-worker response: ${response.status} ${response.statusText}`);
    
    if (response.status === 404) {
      console.log('ℹ️ No ESPN credentials found for user');
      return null;
    }
    
    if (!response.ok) {
      console.error(`❌ Auth-worker error: ${response.status} ${response.statusText}`);
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(`Auth-worker error: ${errorData.error || response.statusText}`);
    }
    
    const data = await response.json() as { success?: boolean; credentials?: EspnCredentials };
    
    if (!data.success || !data.credentials) {
      console.error('❌ Invalid response from auth-worker:', data);
      throw new Error('Invalid credentials response from auth-worker');
    }
    
    console.log('✅ Successfully retrieved ESPN credentials');
    return data.credentials;
    
  } catch (error) {
    console.error('❌ Failed to fetch credentials from auth-worker:', error);
    throw error;
  }
}

/**
 * Fetch user's leagues from auth-worker
 */
async function getUserLeagues(
  clerkUserId: string,
  config: AuthWorkerConfig = {},
  authHeader?: string | null
): Promise<Array<{ leagueId: string; sport: string; teamId?: string }>> {
  try {
    const authWorkerUrl = config.authWorkerUrl || config.defaultUrl;
    const url = `${authWorkerUrl}/leagues`;
    
    console.log(`🏈 Fetching user leagues for ${clerkUserId} from ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Clerk-User-ID': clerkUserId,
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {})
      }
    });
    
    console.log(`📡 Auth-worker leagues response: ${response.status} ${response.statusText}`);
    
    if (response.status === 404) {
      console.log('ℹ️ No leagues found for user');
      return [];
    }
    
    if (!response.ok) {
      console.error(`❌ Auth-worker leagues error: ${response.status} ${response.statusText}`);
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(`Auth-worker error: ${errorData.error || response.statusText}`);
    }
    
    const data = await response.json() as { success?: boolean; leagues?: Array<{ leagueId: string; sport: string; teamId?: string }> };
    
    if (!data.success) {
      console.error('❌ Invalid leagues response from auth-worker:', data);
      return [];
    }
    
    console.log(`✅ Successfully retrieved ${data.leagues?.length || 0} leagues`);
    return data.leagues || [];
    
  } catch (error) {
    console.error('❌ Failed to fetch leagues from auth-worker:', error);
    throw error;
  }
}

// Helper function for CORS headers
const ALLOWED_ORIGINS = [
  'https://*.vercel.app',                          // All Vercel preview deployments
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

  if (origin && isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function isOriginAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.some(allowedOrigin => {
    if (allowedOrigin.includes('*')) {
      // Handle wildcard patterns
      const pattern = allowedOrigin.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(origin);
    }
    return allowedOrigin === origin;
  });
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
    const corsHeaders = getCorsHeaders(request);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check endpoint with auth-worker connectivity test
      if (url.pathname === '/health') {
        const healthData: any = {
          status: 'healthy', 
          service: 'football-espn-mcp',
          version: '1.0.0',
          timestamp: new Date().toISOString()
        };

        // Test auth-worker connectivity
        try {
          if (env.AUTH_WORKER_URL) {
            const authHealthUrl = `${env.AUTH_WORKER_URL}/health`;
            const authResponse = await fetch(authHealthUrl);
            healthData.auth_worker_status = authResponse.ok ? 'connected' : 'error';
            if (!authResponse.ok) {
              healthData.status = 'degraded';
            }
          } else {
            healthData.auth_worker_status = 'not_configured';
            healthData.status = 'degraded';
          }
        } catch (error) {
          healthData.auth_worker_status = 'error';
          healthData.auth_worker_error = error instanceof Error ? error.message : 'Unknown auth-worker error';
          healthData.status = 'degraded';
        }

        healthData.credential_storage = 'supabase_via_auth_worker';

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
            defaultUrl: env.AUTH_WORKER_URL
          };

          const credentials = await getCredentials(clerkUserId, authWorkerConfig, request.headers.get('Authorization'));
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
          const leagues = await getUserLeagues(clerkUserId, authWorkerConfig, request.headers.get('Authorization'));
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
          '/health': 'GET - Health check with auth-worker connectivity test',
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
