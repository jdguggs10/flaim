import { EspnCredentials } from '../../../../auth/espn';

export interface YahooCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email?: string;
  created_at: string;
  updated_at: string;
}


export class UserCredentials {
  constructor(
    private state: DurableObjectState,
    private env: { ENCRYPTION_KEY: string }
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Routes for credential management
      if (url.pathname === '/credentials/espn') {
        return this.handleEspnCredentials(request, corsHeaders);
      }
      
      if (url.pathname === '/credentials/yahoo') {
        return this.handleYahooCredentials(request, corsHeaders);
      }
      
      
      return new Response('Not Found', { 
        status: 404, 
        headers: corsHeaders 
      });
    } catch (error) {
      console.error('UserCredentials error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  private async handleEspnCredentials(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
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

  private async handleYahooCredentials(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    switch (request.method) {
      case 'GET':
        return this.getYahooCredentials(corsHeaders);
      case 'POST':
      case 'PUT':
        return this.setYahooCredentials(request, corsHeaders);
      case 'DELETE':
        return this.deleteYahooCredentials(corsHeaders);
      default:
        return new Response('Method not allowed', { 
          status: 405, 
          headers: corsHeaders 
        });
    }
  }

  private async getEspnCredentials(corsHeaders: Record<string, string>): Promise<Response> {
    // This method is kept for backward compatibility but should use getEspnCredentialsForUser instead
    return new Response(JSON.stringify({ 
      error: 'This endpoint requires a Clerk user ID. Please use the getEspnCredentialsForUser method instead.',
      hasCredentials: false 
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  private async setEspnCredentials(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const { clerkUserId, swid, espn_s2, email } = await request.json();
    
    if (!clerkUserId || !swid || !espn_s2) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: clerkUserId, swid, espn_s2' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const now = new Date().toISOString();
    const credentials: EspnCredentials = {
      clerkUserId,
      swid,
      espn_s2,
      email,
      created_at: now,
      updated_at: now
    };

    const encrypted = await this.encrypt(JSON.stringify(credentials));
    // Store by Clerk user ID for easy lookup
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
    // This method is kept for backward compatibility but should use deleteEspnCredentialsForUser instead
    return new Response(JSON.stringify({ 
      error: 'This endpoint requires a Clerk user ID. Please use the deleteEspnCredentialsForUser method instead.'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  private async getYahooCredentials(corsHeaders: Record<string, string>): Promise<Response> {
    const encrypted = await this.state.storage.get('yahoo_creds') as string;
    if (!encrypted) {
      return new Response(JSON.stringify({ 
        error: 'Yahoo account not linked',
        hasCredentials: false 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    
    try {
      const decrypted = await this.decrypt(encrypted);
      const credentials = JSON.parse(decrypted) as YahooCredentials;
      
      return new Response(JSON.stringify({
        hasCredentials: true,
        email: credentials.email,
        expires_at: credentials.expires_at,
        updated_at: credentials.updated_at
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    } catch (error) {
      console.error('Failed to decrypt Yahoo credentials:', error);
      return new Response(JSON.stringify({ 
        error: 'Failed to retrieve credentials' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  private async setYahooCredentials(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const { access_token, refresh_token, expires_in, email } = await request.json();
    
    if (!access_token || !refresh_token) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: access_token, refresh_token' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + (expires_in * 1000)).toISOString();
    
    const credentials: YahooCredentials = {
      access_token,
      refresh_token,
      expires_at: expiresAt,
      email,
      created_at: now,
      updated_at: now
    };

    const encrypted = await this.encrypt(JSON.stringify(credentials));
    await this.state.storage.put('yahoo_creds', encrypted);

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Yahoo credentials stored successfully' 
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  private async deleteYahooCredentials(corsHeaders: Record<string, string>): Promise<Response> {
    await this.state.storage.delete('yahoo_creds');
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Yahoo credentials deleted successfully' 
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }


  // Internal methods for getting credentials for API calls
  async getEspnCredentialsForApi(clerkUserId: string): Promise<EspnCredentials | null> {
    if (!clerkUserId) return null;
    
    const encrypted = await this.state.storage.get(`espn_creds:${clerkUserId}`) as string;
    if (!encrypted) return null;
    
    try {
      const decrypted = await this.decrypt(encrypted);
      return JSON.parse(decrypted) as EspnCredentials;
    } catch (error) {
      console.error('Failed to decrypt ESPN credentials for API:', error);
      return null;
    }
  }

  // Direct method calls for credential operations (preferred approach)
  async getCredentials(clerkUserId: string): Promise<EspnCredentials | null> {
    return this.getEspnCredentialsForApi(clerkUserId);
  }

  async setCredentials(clerkUserId: string, swid: string, espn_s2: string, email?: string): Promise<boolean> {
    try {
      const now = new Date().toISOString();
      const credentials: EspnCredentials = {
        clerkUserId,
        swid,
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
      const credentials = JSON.parse(decrypted) as EspnCredentials;
      
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
    const { swid, espn_s2, email } = await request.json();
    
    if (!clerkUserId || !swid || !espn_s2) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: clerkUserId, swid, espn_s2' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const now = new Date().toISOString();
    const credentials: EspnCredentials = {
      clerkUserId,
      swid,
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

  // Static method to get ESPN credentials for MCP tools - Direct method call approach
  static async getEspnCredentialsForMcp(env: any, clerkUserId: string): Promise<EspnCredentials | null> {
    if (!clerkUserId) return null;
    
    try {
      const userStoreId = env.USER_DO.idFromString(clerkUserId);
      const userStore = env.USER_DO.get(userStoreId) as any;
      
      // Direct method call - no HTTP overhead or dummy requests
      return await userStore.getEspnCredentialsForApi(clerkUserId);
    } catch (error) {
      console.error('Failed to get ESPN credentials for MCP:', error);
      return null;
    }
  }

  async getYahooCredentialsForApi(): Promise<YahooCredentials | null> {
    const encrypted = await this.state.storage.get('yahoo_creds') as string;
    if (!encrypted) return null;
    
    try {
      const decrypted = await this.decrypt(encrypted);
      return JSON.parse(decrypted) as YahooCredentials;
    } catch (error) {
      console.error('Failed to decrypt Yahoo credentials for API:', error);
      return null;
    }
  }

  private async encrypt(data: string): Promise<string> {
    /*
     * ENCRYPTION KEY ROTATION STRATEGY:
     * 
     * Current implementation uses a single ENCRYPTION_KEY for all users.
     * This is secure with unique IVs but for future key rotation:
     * 
     * 1. Add ENCRYPTION_KEY_V2 environment variable
     * 2. Prefix encrypted data with version: "v1:iv:ciphertext" 
     * 3. Create migration cron job:
     *    - Read old data with v1 key
     *    - Re-encrypt with v2 key  
     *    - Update storage with v2 prefix
     * 4. After migration, remove ENCRYPTION_KEY (v1)
     * 
     * This allows zero-downtime key rotation for compliance.
     */
    const { credentialEncryption } = await import('../../../../auth/shared/encryption.js');
    await credentialEncryption.initialize(this.env.ENCRYPTION_KEY);
    const encrypted = await credentialEncryption.encrypt(data);
    return `${encrypted.iv}:${encrypted.ciphertext}`;
  }

  private async decrypt(encryptedData: string): Promise<string> {
    const { credentialEncryption } = await import('../../../auth/shared/encryption.js');
    await credentialEncryption.initialize(this.env.ENCRYPTION_KEY);
    
    const [iv, ciphertext] = encryptedData.split(':');
    if (!iv || !ciphertext) {
      throw new Error('Invalid encrypted data format');
    }
    
    return await credentialEncryption.decrypt({ iv, ciphertext });
  }
}