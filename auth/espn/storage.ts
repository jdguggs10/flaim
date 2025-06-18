/**
 * ---------------------------------------------------------------------------
 * ESPN Credential Storage – Integration Notes (2025-06-17)
 * ---------------------------------------------------------------------------
 *
 * • Native mobile apps (iOS / Android) can capture the required ESPN cookies
 *   (SWID and espn_s2) via an in-app WebView login flow. Once obtained, POST
 *   them to the `/credentials/espn` Durable-Object endpoint for the currently
 *   authenticated Clerk user (see `handleEspnCredentials`).
 *
 * • The payload expected by `setEspnCredentialsForUser` is:
 *     {
 *       "swid": "{ABCDEF...}",
 *       "espn_s2": "AECEgUg...",
 *       "email": "optional@user.com"
 *     }
 *   with the Clerk user ID passed in `X-Clerk-User-ID` header.
 *
 * • Credentials are encrypted at rest using the shared `ENCRYPTION_KEY`.
 *   Downstream services (MCP workers, league-discovery API) obtain them via
 *   `EspnStorage.getEspnCredentialsForApi/Mcp`.
 *
 * • If you add a new client on another platform, reuse this endpoint rather
 *   than creating an external HTTP route that leaks secrets.
 */

/// <reference types="@cloudflare/workers-types" />

import { credentialEncryption } from '../shared/encryption';
import { EspnCredentials, EspnCredentialsWithMetadata } from './types';

export class EspnStorage {
  constructor(
    private state: DurableObjectState,
    private env: { ENCRYPTION_KEY: string }
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-ID',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Handle credentials endpoints
      if (url.pathname.startsWith('/credentials/espn')) {
        return this.handleEspnCredentials(request, corsHeaders);
      }
      
      return new Response('Not Found', { 
        status: 404, 
        headers: corsHeaders 
      });
    } catch (error) {
      console.error('EspnStorage error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  private async handleEspnCredentials(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle API endpoint for fetching full credentials
    if (url.pathname === '/credentials/espn/api') {
      const clerkUserId = request.headers.get('X-Clerk-User-ID');
      if (!clerkUserId) {
        return new Response(JSON.stringify({ 
          error: 'Clerk user ID required in X-Clerk-User-ID header'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      return this.getEspnCredentialsForUser(corsHeaders, clerkUserId);
    }

    // Handle regular endpoints
    switch (request.method) {
      case 'GET':
        return this.getEspnCredentials(corsHeaders);
      case 'POST':
      case 'PUT':
        return this.setEspnCredentials(request, corsHeaders);
      case 'DELETE':
        return this.deleteEspnCredentials(corsHeaders);
      default:
        return new Response('Method not allowed', { 
          status: 405, 
          headers: corsHeaders 
        });
    }
  }

  private async getEspnCredentials(corsHeaders: Record<string, string>): Promise<Response> {
    // This method is deprecated - use direct method calls or handleEspnCredentialsWithUserId instead
    return new Response(JSON.stringify({ 
      error: 'This endpoint requires a Clerk user ID. Use handleEspnCredentialsWithUserId or direct method calls instead.',
      hasCredentials: false 
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  private async setEspnCredentials(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const body = await request.json() as any;
    const { clerkUserId, swid, espn_s2, email } = body;
    
    if (!clerkUserId || !swid || !espn_s2) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: clerkUserId, swid, espn_s2' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const now = new Date().toISOString();
    const credentials: EspnCredentialsWithMetadata = {
      clerkUserId,
      swid,
      s2: espn_s2,
      espn_s2,
      email,
      created_at: now,
      updated_at: now
    };

    const encrypted = await this.encrypt(JSON.stringify(credentials));
    await this.state.storage.put(`espn_creds:${clerkUserId}`, encrypted);

    return new Response(JSON.stringify({ 
      success: true,
      message: 'ESPN credentials stored successfully',
      clerkUserId 
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  private async deleteEspnCredentials(corsHeaders: Record<string, string>): Promise<Response> {
    // This method is deprecated - use direct method calls or handleEspnCredentialsWithUserId instead
    return new Response(JSON.stringify({ 
      error: 'This endpoint requires a Clerk user ID. Use handleEspnCredentialsWithUserId or direct method calls instead.' 
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Note: getClerkUserIdFromHeaders() method removed - use direct method calls instead

  // Direct method calls for credential operations (preferred approach)
  async getCredentials(clerkUserId: string): Promise<EspnCredentials | null> {
    return this.getEspnCredentialsForApi(clerkUserId);
  }

  async setCredentials(clerkUserId: string, swid: string, espn_s2: string, email?: string): Promise<boolean> {
    try {
      const now = new Date().toISOString();
      const credentials: EspnCredentialsWithMetadata = {
        clerkUserId,
        swid,
        s2: espn_s2,
        espn_s2,
        email,
        created_at: now,
        updated_at: now
      };

      const encrypted = await this.encrypt(JSON.stringify(credentials));
      await this.state.storage.put(`espn_creds:${clerkUserId}`, encrypted);
      return true;
    } catch (error) {
      console.error('Failed to set ESPN credentials:', error);
      return false;
    }
  }

  async deleteCredentials(clerkUserId: string): Promise<boolean> {
    try {
      await this.state.storage.delete(`espn_creds:${clerkUserId}`);
      return true;
    } catch (error) {
      console.error('Failed to delete ESPN credentials:', error);
      return false;
    }
  }

  async hasCredentials(clerkUserId: string): Promise<boolean> {
    const encrypted = await this.state.storage.get(`espn_creds:${clerkUserId}`) as string;
    return !!encrypted;
  }

  // HTTP-style method for backwards compatibility (when called from external HTTP requests)
  async handleEspnCredentialsWithUserId(request: Request, corsHeaders: Record<string, string>, clerkUserId: string): Promise<Response> {
    switch (request.method) {
      case 'GET':
        return this.getEspnCredentialsForUser(corsHeaders, clerkUserId);
      case 'POST':
      case 'PUT':
        return this.setEspnCredentialsForUser(request, corsHeaders, clerkUserId);
      case 'DELETE':
        return this.deleteEspnCredentialsForUser(corsHeaders, clerkUserId);
      default:
        return new Response('Method not allowed', { 
          status: 405, 
          headers: corsHeaders 
        });
    }
  }

  private async getEspnCredentialsForUser(corsHeaders: Record<string, string>, clerkUserId: string): Promise<Response> {
    if (!clerkUserId) {
      return new Response(JSON.stringify({ 
        error: 'Clerk user ID required',
        hasCredentials: false 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const encrypted = await this.state.storage.get(`espn_creds:${clerkUserId}`) as string;
    if (!encrypted) {
      return new Response(JSON.stringify({ 
        error: 'ESPN account not linked',
        hasCredentials: false,
        clerkUserId 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    
    try {
      const decrypted = await this.decrypt(encrypted);
      const credentials = JSON.parse(decrypted) as EspnCredentialsWithMetadata;
      
      return new Response(JSON.stringify({
        hasCredentials: true,
        clerkUserId: credentials.clerkUserId,
        email: credentials.email,
        updated_at: credentials.updated_at
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (error) {
      console.error('Failed to decrypt ESPN credentials:', error);
      return new Response(JSON.stringify({ 
        error: 'Failed to retrieve credentials' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  private async setEspnCredentialsForUser(request: Request, corsHeaders: Record<string, string>, clerkUserId: string): Promise<Response> {
    const body = await request.json() as any;
    const { swid, espn_s2, email } = body;
    
    if (!clerkUserId || !swid || !espn_s2) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: clerkUserId, swid, espn_s2' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const now = new Date().toISOString();
    const credentials: EspnCredentialsWithMetadata = {
      clerkUserId,
      swid,
      s2: espn_s2,
      espn_s2,
      email,
      created_at: now,
      updated_at: now
    };

    const encrypted = await this.encrypt(JSON.stringify(credentials));
    await this.state.storage.put(`espn_creds:${clerkUserId}`, encrypted);

    return new Response(JSON.stringify({ 
      success: true,
      message: 'ESPN credentials stored successfully',
      clerkUserId 
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  private async deleteEspnCredentialsForUser(corsHeaders: Record<string, string>, clerkUserId: string): Promise<Response> {
    if (!clerkUserId) {
      return new Response(JSON.stringify({ 
        error: 'Clerk user ID required' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    await this.state.storage.delete(`espn_creds:${clerkUserId}`);
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'ESPN credentials deleted successfully',
      clerkUserId 
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Internal method for getting credentials for API calls
  async getEspnCredentialsForApi(clerkUserId: string): Promise<EspnCredentials | null> {
    if (!clerkUserId) return null;
    
    const encrypted = await this.state.storage.get(`espn_creds:${clerkUserId}`) as string;
    if (!encrypted) return null;
    
    try {
      const decrypted = await this.decrypt(encrypted);
      const fullCredentials = JSON.parse(decrypted) as EspnCredentialsWithMetadata;
      // Return only the core credential fields
      return {
        swid: fullCredentials.swid,
        s2: fullCredentials.s2 || fullCredentials.espn_s2 || ''
      };
    } catch (error) {
      console.error('Failed to decrypt ESPN credentials for API:', error);
      return null;
    }
  }

  // Static method to get ESPN credentials for MCP tools
  static async getEspnCredentialsForMcp(env: any, clerkUserId: string): Promise<EspnCredentials | null> {
    if (!clerkUserId) return null;
    
    try {
      const userStoreId = env.USER_DO.idFromString(clerkUserId);
      const userStore = env.USER_DO.get(userStoreId);
      
      // Use the HTTP endpoint to get credentials
      const response = await userStore.fetch('https://dummy.com/credentials/espn', {
        method: 'GET',
        headers: {
          'X-Clerk-User-ID': clerkUserId
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch credentials: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.hasCredentials) {
        return null;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to get ESPN credentials for MCP:', error);
      return null;
    }
  }

  private async encrypt(data: string): Promise<string> {
    await credentialEncryption.initialize(this.env.ENCRYPTION_KEY);
    const encrypted = await credentialEncryption.encrypt(data);
    return `${encrypted.iv}:${encrypted.ciphertext}`;
  }

  private async decrypt(encryptedData: string): Promise<string> {
    await credentialEncryption.initialize(this.env.ENCRYPTION_KEY);
    
    const [iv, ciphertext] = encryptedData.split(':');
    if (!iv || !ciphertext) {
      throw new Error('Invalid encrypted data format');
    }
    
    return await credentialEncryption.decrypt({ iv, ciphertext });
  }
}