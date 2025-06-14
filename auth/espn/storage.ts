import { credentialEncryption } from '../shared/encryption';
import { EspnCredentials } from './types';

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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (url.pathname === '/credentials/espn') {
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

  private async getEspnCredentials(corsHeaders: Record<string, string>): Promise<Response> {
    const clerkUserId = this.getClerkUserIdFromHeaders();
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

  private async deleteEspnCredentials(corsHeaders: Record<string, string>): Promise<Response> {
    const clerkUserId = this.getClerkUserIdFromHeaders();
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

  // Helper method to extract Clerk user ID from request headers
  private getClerkUserIdFromHeaders(): string | null {
    // This will be accessed via the current request context
    // For now, return null - this needs to be passed from the calling context
    return null;
  }

  // Methods with clerkUserId parameter for external access
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

  // Internal method for getting credentials for API calls
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

  // Static method to get ESPN credentials for MCP tools
  static async getEspnCredentialsForMcp(env: any, clerkUserId: string): Promise<EspnCredentials | null> {
    if (!clerkUserId) return null;
    
    try {
      const userStoreId = env.USER_DO.idFromString(clerkUserId);
      const userStore = env.USER_DO.get(userStoreId);
      
      const credentialRequest = new Request('https://dummy.com/credentials/espn', {
        method: 'GET',
        headers: {
          'X-Clerk-User-ID': clerkUserId
        }
      });
      
      const response = await (userStore as any).handleEspnCredentialsWithUserId(
        credentialRequest, 
        {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }, 
        clerkUserId
      );
      
      const data = await response.json();
      
      if (data.hasCredentials) {
        const credentialsInstance = userStore as any;
        return await credentialsInstance.getEspnCredentialsForApi(clerkUserId);
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