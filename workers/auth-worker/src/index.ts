/**
 * Auth Worker - Platform-Agnostic Credential Storage
 * 
 * Centralized Cloudflare Worker for handling all platform credentials
 * (ESPN, Yahoo, Sleeper, etc.) with encrypted KV storage.
 * 
 * Endpoints:
 * - GET /health - Health check with KV connectivity test
 * - POST /credentials/:platform - Store platform credentials
 * - GET /credentials/:platform - Get credential metadata
 * - DELETE /credentials/:platform - Delete platform credentials
 * 
 * @version 1.0.0
 */

export interface Env {
  CF_KV_CREDENTIALS: KVNamespace;
  CF_ENCRYPTION_KEY: string;
  NODE_ENV?: string;
}

// Platform-specific credential interfaces
interface EspnCredentials {
  swid: string;
  s2: string;
  email?: string;
}

interface YahooCredentials {
  access_token: string;
  refresh_token?: string;
  email?: string;
}

interface SleeperCredentials {
  access_token: string;
  email?: string;
}

type PlatformCredentials = EspnCredentials | YahooCredentials | SleeperCredentials;

interface CredentialMetadata {
  platform: string;
  clerkUserId: string;
  created_at: string;
  updated_at: string;
  email?: string;
}

// Simple encryption/decryption utilities
class CredentialEncryption {
  private key: CryptoKey | null = null;

  async initialize(encryptionKey: string): Promise<void> {
    if (this.key) return;
    
    const keyBuffer = new TextEncoder().encode(encryptionKey.padEnd(32, '0').slice(0, 32));
    this.key = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encrypt(data: string): Promise<{ iv: string; ciphertext: string }> {
    if (!this.key) throw new Error('Encryption key not initialized');
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedData = new TextEncoder().encode(data);
    
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.key,
      encodedData
    );
    
    return {
      iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
      ciphertext: Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join('')
    };
  }

  async decrypt(encryptedData: { iv: string; ciphertext: string }): Promise<string> {
    if (!this.key) throw new Error('Encryption key not initialized');
    
    const iv = new Uint8Array(encryptedData.iv.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
    const ciphertext = new Uint8Array(encryptedData.ciphertext.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.key,
      ciphertext
    );
    
    return new TextDecoder().decode(decrypted);
  }
}

// Platform-agnostic credential storage
class PlatformCredentialStorage {
  private kvNamespace: KVNamespace;
  private encryption: CredentialEncryption;
  private encryptionKey: string;

  constructor(kvNamespace: KVNamespace, encryptionKey: string) {
    this.kvNamespace = kvNamespace;
    this.encryption = new CredentialEncryption();
    this.encryptionKey = encryptionKey;
  }

  private async ensureEncryptionInitialized(): Promise<void> {
    await this.encryption.initialize(this.encryptionKey);
  }

  private getCredentialKey(platform: string, clerkUserId: string): string {
    return `${platform}_creds:${clerkUserId}`;
  }

  async storeCredentials(platform: string, clerkUserId: string, credentials: PlatformCredentials): Promise<boolean> {
    try {
      await this.ensureEncryptionInitialized();
      
      const now = new Date().toISOString();
      const credentialData: CredentialMetadata & { credentials: PlatformCredentials } = {
        platform,
        clerkUserId,
        created_at: now,
        updated_at: now,
        email: 'email' in credentials ? credentials.email : undefined,
        credentials
      };

      const encrypted = await this.encryption.encrypt(JSON.stringify(credentialData));
      const key = this.getCredentialKey(platform, clerkUserId);
      
      await this.kvNamespace.put(key, JSON.stringify(encrypted), {
        metadata: {
          platform,
          clerkUserId,
          lastUpdated: now,
          hasEmail: !!credentialData.email
        }
      });

      return true;
    } catch (error) {
      console.error(`Failed to store ${platform} credentials:`, error);
      return false;
    }
  }

  async getCredentials(platform: string, clerkUserId: string): Promise<PlatformCredentials | null> {
    try {
      await this.ensureEncryptionInitialized();
      
      const key = this.getCredentialKey(platform, clerkUserId);
      const encryptedData = await this.kvNamespace.get(key);
      
      if (!encryptedData) return null;

      const encrypted = JSON.parse(encryptedData);
      const decrypted = await this.encryption.decrypt(encrypted);
      const credentialData = JSON.parse(decrypted);
      
      return credentialData.credentials;
    } catch (error) {
      console.error(`Failed to retrieve ${platform} credentials:`, error);
      return null;
    }
  }

  async getCredentialMetadata(platform: string, clerkUserId: string): Promise<{ hasCredentials: boolean; email?: string; lastUpdated?: string } | null> {
    try {
      const key = this.getCredentialKey(platform, clerkUserId);
      const { value, metadata } = await this.kvNamespace.getWithMetadata(key);
      
      if (!value) {
        return { hasCredentials: false };
      }

      return {
        hasCredentials: true,
        email: (metadata as any)?.hasEmail ? 'Available' : undefined,
        lastUpdated: (metadata as any)?.lastUpdated as string
      };
    } catch (error) {
      console.error(`Failed to get ${platform} credential metadata:`, error);
      return { hasCredentials: false };
    }
  }

  async deleteCredentials(platform: string, clerkUserId: string): Promise<boolean> {
    try {
      const key = this.getCredentialKey(platform, clerkUserId);
      await this.kvNamespace.delete(key);
      return true;
    } catch (error) {
      console.error(`Failed to delete ${platform} credentials:`, error);
      return false;
    }
  }
}

// CORS helper - Allow sport workers and Next.js origins
const ALLOWED_ORIGINS = [
  'https://dev.flaim-frontend-dev.pages.dev',      // Stable Dev Preview URL
  'https://flaim.app',                             // Production URL (Assumed)
  'http://localhost:8787',                         // Local Wrangler dev server
  'https://localhost:8787',                        // Local Wrangler dev server (HTTPS)
  'http://localhost:3000',                         // Local Next.js dev server
];

function getCorsHeaders(request: Request) {
  const origin = request.headers.get('Origin');
  const headers: { [key: string]: string } = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-ID',
    'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
  };

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

// Extract Clerk User ID from header
function getClerkUserId(request: Request): { userId: string | null; error?: string } {
  const clerkUserId = request.headers.get('X-Clerk-User-ID');
  
  if (!clerkUserId) {
    return { userId: null, error: 'Missing X-Clerk-User-ID header' };
  }

  return { userId: clerkUserId };
}

// Validate platform credentials
function validateCredentials(platform: string, credentials: any): { valid: boolean; error?: string } {
  switch (platform.toLowerCase()) {
    case 'espn':
      if (!credentials.swid || !credentials.s2) {
        return { valid: false, error: 'ESPN credentials require swid and s2 fields' };
      }
      break;
    case 'yahoo':
      if (!credentials.access_token) {
        return { valid: false, error: 'Yahoo credentials require access_token field' };
      }
      break;
    case 'sleeper':
      if (!credentials.access_token) {
        return { valid: false, error: 'Sleeper credentials require access_token field' };
      }
      break;
    default:
      return { valid: false, error: `Unsupported platform: ${platform}` };
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
          version: '1.0.0',
          timestamp: new Date().toISOString(),
          supportedPlatforms: ['espn', 'yahoo', 'sleeper']
        };

        // Test KV connectivity
        try {
          if (env.CF_KV_CREDENTIALS) {
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

        // Test encryption key
        if (env.CF_ENCRYPTION_KEY) {
          healthData.encryption_status = 'configured';
        } else {
          healthData.encryption_status = 'missing';
          healthData.status = 'degraded';
        }

        // Health check does not require Clerk configuration
        healthData.auth_method = 'X-Clerk-User-ID header';

        const statusCode = healthData.status === 'healthy' ? 200 : 503;

        return new Response(JSON.stringify(healthData), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Credential management endpoints
      const credentialMatch = url.pathname.match(/^\/credentials\/([^\/]+)$/);
      if (credentialMatch) {
        const platform = credentialMatch[1];
        
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

        const storage = new PlatformCredentialStorage(env.CF_KV_CREDENTIALS, env.CF_ENCRYPTION_KEY);

        if (request.method === 'POST' || request.method === 'PUT') {
          // Store credentials
          const body = await request.json();
          const validation = validateCredentials(platform, body);
          
          if (!validation.valid) {
            return new Response(JSON.stringify({
              error: 'Invalid credentials',
              message: validation.error
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          const success = await storage.storeCredentials(platform, clerkUserId, body as PlatformCredentials);
          
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
            message: `${platform} credentials stored successfully`
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });

        } else if (request.method === 'GET') {
          // Check if this is a request for actual credentials (from sport workers)
          const getRawCredentials = url.searchParams.get('raw') === 'true';
          
          if (getRawCredentials) {
            // Return actual credentials for sport workers
            const credentials = await storage.getCredentials(platform, clerkUserId);
            
            if (!credentials) {
              return new Response(JSON.stringify({
                error: 'Credentials not found',
                message: `No ${platform} credentials found for user`
              }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
              });
            }

            return new Response(JSON.stringify({
              success: true,
              platform,
              credentials
            }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          } else {
            // Get credential metadata (default behavior for frontend)
            const metadata = await storage.getCredentialMetadata(platform, clerkUserId);
            
            if (!metadata?.hasCredentials) {
              return new Response(JSON.stringify({
                hasCredentials: false,
                message: `No ${platform} credentials found`
              }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
              });
            }

            return new Response(JSON.stringify({
              hasCredentials: true,
              platform,
              email: metadata.email,
              lastUpdated: metadata.lastUpdated
            }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

        } else if (request.method === 'DELETE') {
          // Delete credentials
          const success = await storage.deleteCredentials(platform, clerkUserId);
          
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
            message: `${platform} credentials deleted successfully`
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

      // -------------------------------------------------------------------
      // League management endpoint (ESPN only for now)
      // POST /leagues  -> store leagues array
      // GET  /leagues  -> retrieve leagues array metadata
      // -------------------------------------------------------------------

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

        // Lazily import to keep worker bundle size small
        // eslint-disable-next-line  @typescript-eslint/consistent-type-imports
        const { EspnKVStorage } = await import('../../../auth/espn/kv-storage');

        const storage = new EspnKVStorage({
          kv: env.CF_KV_CREDENTIALS,
          encryptionKey: env.CF_ENCRYPTION_KEY
        });

        if (request.method === 'POST' || request.method === 'PUT') {
          // Save leagues
          const body = (await request.json()) as any;
          const leagues = body?.leagues as Array<{ leagueId: string; sport: string }> | undefined;

          if (!leagues || !Array.isArray(leagues)) {
            return new Response(JSON.stringify({
              error: 'Invalid request: leagues array is required'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          // Basic validation (duplicate check handled by storage layer)
          if (leagues.length > 10) {
            return new Response(JSON.stringify({
              error: 'Maximum of 10 leagues allowed per user'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          const success = await storage.setLeagues(clerkUserId, leagues as any);

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
            leagues: leagues || [],
            totalLeagues: leagues?.length || 0
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

          const currentLeagues = await storage.getLeagues(clerkUserId) || [];
          const updatedLeagues = currentLeagues.filter(l => !(l.leagueId === leagueId && l.sport === sport));

          const success = await storage.setLeagues(clerkUserId, updatedLeagues);

          if (!success) {
            return new Response(JSON.stringify({
              error: 'Failed to remove league'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

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

      // -------------------------------------------------------------------
      // League team selection endpoint
      // PATCH /leagues/:leagueId/team  -> update specific league's team selection
      // -------------------------------------------------------------------

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

        // Import storage
        const { EspnKVStorage } = await import('../../../auth/espn/kv-storage');
        const storage = new EspnKVStorage({
          kv: env.CF_KV_CREDENTIALS,
          encryptionKey: env.CF_ENCRYPTION_KEY
        });

        // Get current leagues (use full league data with teamId support)
        const currentLeagues = await storage.getLeagues(clerkUserId) || [];
        
        // Find and update the specific league
        const leagueIndex = currentLeagues.findIndex(league => 
          league.leagueId === leagueId && 
          (sport ? league.sport === sport : true)
        );

        if (leagueIndex === -1) {
          return new Response(JSON.stringify({
            error: 'League not found',
            message: `League ${leagueId}${sport ? ` for sport ${sport}` : ''} not found for user`
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Update league with team selection
        const updatedLeagues = [...currentLeagues];
        updatedLeagues[leagueIndex] = {
          ...updatedLeagues[leagueIndex],
          teamId,
          ...(teamName ? { teamName } : {}),
          ...(leagueName ? { leagueName } : {}),
          ...(seasonYear ? { seasonYear } : {})
        };

        // Save updated leagues (use full league data method)
        const success = await storage.setLeagues(clerkUserId, updatedLeagues);

        if (!success) {
          return new Response(JSON.stringify({
            error: 'Failed to update team selection'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'Team selection updated successfully',
          league: updatedLeagues[leagueIndex]
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // 404 for unknown endpoints
      return new Response(JSON.stringify({
        error: 'Endpoint not found',
        message: 'Available endpoints',
        endpoints: {
          '/health': 'GET - Health check with KV connectivity test',
          '/credentials/:platform': 'GET/POST/DELETE - Platform credential management (ESPN, Yahoo, Sleeper)',
          '/credentials/:platform?raw=true': 'GET - Retrieve actual credentials for sport workers',
          '/leagues': 'GET/POST/DELETE - League management (list, store, remove)',
          '/leagues/:leagueId/team': 'PATCH - Update team selection for specific league'
        },
        supportedPlatforms: ['espn', 'yahoo', 'sleeper'],
        version: '1.0.0'
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