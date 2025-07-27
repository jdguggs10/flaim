/**
 * Auth Worker - Supabase-based Credential Storage
 * 
 * Centralized Cloudflare Worker for handling ESPN credentials
 * with Supabase PostgreSQL storage.
 * 
 * Endpoints:
 * - GET /health - Health check with Supabase connectivity test
 * - POST /credentials/espn - Store ESPN credentials
 * - GET /credentials/espn - Get ESPN credential metadata
 * - DELETE /credentials/espn - Delete ESPN credentials
 * - GET /credentials/espn?raw=true - Get raw credentials for MCP workers
 * - POST /leagues - Store ESPN leagues
 * - GET /leagues - Get ESPN leagues
 * - DELETE /leagues - Remove specific league
 * - PATCH /leagues/:leagueId/team - Update team selection
 * 
 * @version 2.0.0 - Supabase implementation
 */

import { EspnSupabaseStorage } from './supabase-storage';
import { EspnCredentials, EspnLeague } from './espn-types';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  NODE_ENV?: string;
}

// CORS helper - Allow sport workers and Next.js origins
const ALLOWED_ORIGINS = [
  // Vercel deployments
  'https://*.vercel.app',                          // All Vercel preview deployments
  // Production
  'https://flaim.app',
  // Local development
  'http://localhost:8787',                         // Wrangler dev server (HTTP)
  'https://localhost:8787',                        // Wrangler dev server (HTTPS)
  'http://localhost:3000',                         // Next.js dev server
];

function getCorsHeaders(request: Request) {
  const origin = request.headers.get('Origin');
  const headers: { [key: string]: string } = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-ID',
    'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
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

// Extract Clerk User ID from header
function getClerkUserId(request: Request): { userId: string | null; error?: string } {
  const clerkUserId = request.headers.get('X-Clerk-User-ID');
  
  if (!clerkUserId) {
    return { userId: null, error: 'Missing X-Clerk-User-ID header' };
  }

  return { userId: clerkUserId };
}

// Validate ESPN credentials
function validateEspnCredentials(credentials: any): { valid: boolean; error?: string } {
  if (!credentials.swid || !credentials.s2) {
    return { valid: false, error: 'ESPN credentials require swid and s2 fields' };
  }
  
  return { valid: true };
}

// Main request handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check endpoint
      if (url.pathname === '/health') {
        const healthData: any = {
          status: 'healthy',
          service: 'auth-worker',
          version: '2.0.0',
          timestamp: new Date().toISOString(),
          storage: 'supabase'
        };

        // Test Supabase connectivity
        try {
          if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
            const storage = EspnSupabaseStorage.fromEnvironment(env);
            // Simple connectivity test
            await storage.hasCredentials('health-check-test');
            healthData.supabase_status = 'connected';
          } else {
            healthData.supabase_status = 'not_configured';
            healthData.status = 'degraded';
          }
        } catch (error) {
          healthData.supabase_status = 'error';
          healthData.supabase_error = error instanceof Error ? error.message : 'Unknown Supabase error';
          healthData.status = 'degraded';
        }

        healthData.auth_method = 'X-Clerk-User-ID header';

        const statusCode = healthData.status === 'healthy' ? 200 : 503;

        return new Response(JSON.stringify(healthData), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // ESPN credential management endpoints
      if (url.pathname === '/credentials/espn') {
        // Extract Clerk User ID from header
        const { userId: clerkUserId, error: authError } = getClerkUserId(request);
        if (!clerkUserId) {
          return new Response(JSON.stringify({
            error: 'Authentication required',
            message: authError || 'Missing X-Clerk-User-ID header'
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const storage = EspnSupabaseStorage.fromEnvironment(env);

        if (request.method === 'POST' || request.method === 'PUT') {
          // Store ESPN credentials
          const body = await request.json();
          const validation = validateEspnCredentials(body);
          
          if (!validation.valid) {
            return new Response(JSON.stringify({
              error: 'Invalid credentials',
              message: validation.error
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          const success = await storage.setCredentials(clerkUserId, body.swid, body.s2, body.email);
          
          if (!success) {
            return new Response(JSON.stringify({
              error: 'Failed to store credentials'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          return new Response(JSON.stringify({
            success: true,
            message: 'ESPN credentials stored successfully'
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });

        } else if (request.method === 'GET') {
          // Check if this is a request for actual credentials (from sport workers)
          const getRawCredentials = url.searchParams.get('raw') === 'true';
          
          if (getRawCredentials) {
            // Return actual credentials for sport workers
            const credentials = await storage.getCredentials(clerkUserId);
            
            if (!credentials) {
              return new Response(JSON.stringify({
                error: 'Credentials not found',
                message: 'No ESPN credentials found for user'
              }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
              });
            }

            return new Response(JSON.stringify({
              success: true,
              platform: 'espn',
              credentials
            }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          } else {
            // Get credential metadata (default behavior for frontend)
            const metadata = await storage.getCredentialMetadata(clerkUserId);
            
            if (!metadata?.hasCredentials) {
              return new Response(JSON.stringify({
                hasCredentials: false,
                message: 'No ESPN credentials found'
              }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
              });
            }

            return new Response(JSON.stringify({
              hasCredentials: true,
              platform: 'espn',
              email: metadata.email,
              lastUpdated: metadata.lastUpdated
            }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

        } else if (request.method === 'DELETE') {
          // Delete ESPN credentials
          const success = await storage.deleteCredentials(clerkUserId);
          
          if (!success) {
            return new Response(JSON.stringify({
              error: 'Failed to delete credentials'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          return new Response(JSON.stringify({
            success: true,
            message: 'ESPN credentials deleted successfully'
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        return new Response(JSON.stringify({
          error: 'Method not allowed'
        }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // League management endpoints
      if (url.pathname === '/leagues') {
        // Extract Clerk User ID from header
        const { userId: clerkUserId, error: authError } = getClerkUserId(request);
        if (!clerkUserId) {
          return new Response(JSON.stringify({
            error: 'Authentication required',
            message: authError || 'Missing X-Clerk-User-ID header'
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const storage = EspnSupabaseStorage.fromEnvironment(env);

        if (request.method === 'POST' || request.method === 'PUT') {
          // Save leagues
          const body = (await request.json()) as any;
          const leagues = body?.leagues as EspnLeague[] | undefined;

          if (!leagues || !Array.isArray(leagues)) {
            return new Response(JSON.stringify({
              error: 'Invalid request: leagues array is required'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          // Basic validation
          if (leagues.length > 10) {
            return new Response(JSON.stringify({
              error: 'Maximum of 10 leagues allowed per user'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          const success = await storage.setLeagues(clerkUserId, leagues);

          if (!success) {
            return new Response(JSON.stringify({
              error: 'Failed to store leagues'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          return new Response(JSON.stringify({
            success: true,
            message: 'Leagues saved successfully',
            totalLeagues: leagues.length,
            leagues
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });

        } else if (request.method === 'GET') {
          const leagues = await storage.getLeagues(clerkUserId);

          return new Response(JSON.stringify({
            success: true,
            leagues,
            totalLeagues: leagues.length
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });

        } else if (request.method === 'DELETE') {
          // Remove a single league
          const urlObj = new URL(request.url);
          const leagueId = urlObj.searchParams.get('leagueId');
          const sport = urlObj.searchParams.get('sport');

          if (!leagueId || !sport) {
            return new Response(JSON.stringify({
              error: 'leagueId and sport query parameters are required'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          const success = await storage.removeLeague(clerkUserId, leagueId, sport);

          if (!success) {
            return new Response(JSON.stringify({
              error: 'Failed to remove league'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          // Get updated leagues list
          const updatedLeagues = await storage.getLeagues(clerkUserId);

          return new Response(JSON.stringify({
            success: true,
            message: 'League removed',
            totalLeagues: updatedLeagues.length,
            leagues: updatedLeagues
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        return new Response(JSON.stringify({
          error: 'Method not allowed'
        }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // League team selection endpoint
      const leagueTeamMatch = url.pathname.match(/^\/leagues\/([^\/]+)\/team$/);
      if (leagueTeamMatch && request.method === 'PATCH') {
        const leagueId = leagueTeamMatch[1];
        
        // Extract Clerk User ID from header
        const { userId: clerkUserId, error: authError } = getClerkUserId(request);
        if (!clerkUserId) {
          return new Response(JSON.stringify({
            error: 'Authentication required',
            message: authError || 'Missing X-Clerk-User-ID header'
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const body = await request.json() as any;
        const { teamId, sport, teamName, leagueName, seasonYear } = body;

        if (!teamId) {
          return new Response(JSON.stringify({
            error: 'teamId is required in request body'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const storage = EspnSupabaseStorage.fromEnvironment(env);

        // Get current leagues
        const currentLeagues = await storage.getLeagues(clerkUserId);
        
        // Find the specific league
        const league = currentLeagues.find(l => 
          l.leagueId === leagueId && 
          (sport ? l.sport === sport : true)
        );

        if (!league) {
          return new Response(JSON.stringify({
            error: 'League not found',
            message: `League ${leagueId}${sport ? ` for sport ${sport}` : ''} not found for user`
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Update league with new team information
        const updates: Partial<EspnLeague> = { teamId };
        if (teamName) updates.teamName = teamName;
        if (leagueName) updates.leagueName = leagueName;
        if (seasonYear) updates.seasonYear = seasonYear;

        const success = await storage.updateLeague(clerkUserId, leagueId, updates);

        if (!success) {
          return new Response(JSON.stringify({
            error: 'Failed to update team selection'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Get updated league info
        const updatedLeagues = await storage.getLeagues(clerkUserId);
        const updatedLeague = updatedLeagues.find(l => l.leagueId === leagueId && l.sport === league.sport);

        return new Response(JSON.stringify({
          success: true,
          message: 'Team selection updated successfully',
          league: updatedLeague
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // 404 for unknown endpoints
      return new Response(JSON.stringify({
        error: 'Endpoint not found',
        message: 'Available endpoints',
        endpoints: {
          '/health': 'GET - Health check with Supabase connectivity test',
          '/credentials/espn': 'GET/POST/DELETE - ESPN credential management',
          '/credentials/espn?raw=true': 'GET - Retrieve actual credentials for sport workers',
          '/leagues': 'GET/POST/DELETE - League management (list, store, remove)',
          '/leagues/:leagueId/team': 'PATCH - Update team selection for specific league'
        },
        storage: 'supabase',
        version: '2.0.0'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('Auth worker error:', error);
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