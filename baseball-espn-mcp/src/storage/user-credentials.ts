export interface EspnCredentials {
  swid: string;
  espn_s2: string;
  email?: string;
  created_at: string;
  updated_at: string;
}

export interface YahooCredentials {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email?: string;
  created_at: string;
  updated_at: string;
}

export interface UserSubscription {
  plan: "free" | "pro";
  status: "active" | "inactive" | "cancelled" | "past_due";
  stripe_customer_id: string;
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
      
      if (url.pathname.startsWith('/subscription/')) {
        const status = url.pathname.split('/')[2];
        return this.updateSubscriptionStatus(status, corsHeaders);
      }
      
      if (url.pathname === '/subscription') {
        return this.getSubscriptionStatus(corsHeaders);
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
    const encrypted = await this.state.storage.get('espn_creds') as string;
    if (!encrypted) {
      return new Response(JSON.stringify({ 
        error: 'ESPN account not linked',
        hasCredentials: false 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    
    try {
      const decrypted = await this.decrypt(encrypted);
      const credentials = JSON.parse(decrypted) as EspnCredentials;
      
      // Return credentials without sensitive data for validation
      return new Response(JSON.stringify({
        hasCredentials: true,
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
    const { swid, espn_s2, email } = await request.json();
    
    if (!swid || !espn_s2) {
      return new Response(JSON.stringify({ 
        error: 'Missing required fields: swid, espn_s2' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const now = new Date().toISOString();
    const credentials: EspnCredentials = {
      swid,
      espn_s2,
      email,
      created_at: now,
      updated_at: now
    };

    const encrypted = await this.encrypt(JSON.stringify(credentials));
    await this.state.storage.put('espn_creds', encrypted);

    return new Response(JSON.stringify({ 
      success: true,
      message: 'ESPN credentials stored successfully' 
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  private async deleteEspnCredentials(corsHeaders: Record<string, string>): Promise<Response> {
    await this.state.storage.delete('espn_creds');
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'ESPN credentials deleted successfully' 
    }), {
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

  private async updateSubscriptionStatus(status: string, corsHeaders: Record<string, string>): Promise<Response> {
    const subscription: UserSubscription = {
      plan: status === 'active' ? 'pro' : 'free',
      status: status as UserSubscription['status'],
      stripe_customer_id: await this.state.storage.get('stripe_customer_id') as string || '',
      updated_at: new Date().toISOString()
    };

    await this.state.storage.put('subscription', subscription);

    return new Response(JSON.stringify({ 
      success: true,
      subscription 
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  private async getSubscriptionStatus(corsHeaders: Record<string, string>): Promise<Response> {
    const subscription = await this.state.storage.get('subscription') as UserSubscription;
    
    return new Response(JSON.stringify({
      subscription: subscription || {
        plan: 'free',
        status: 'inactive',
        stripe_customer_id: '',
        updated_at: new Date().toISOString()
      }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Internal methods for getting credentials for API calls
  async getEspnCredentialsForApi(): Promise<EspnCredentials | null> {
    const encrypted = await this.state.storage.get('espn_creds') as string;
    if (!encrypted) return null;
    
    try {
      const decrypted = await this.decrypt(encrypted);
      return JSON.parse(decrypted) as EspnCredentials;
    } catch (error) {
      console.error('Failed to decrypt ESPN credentials for API:', error);
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
    const { credentialEncryption } = await import('../crypto/encryption.js');
    await credentialEncryption.initialize(this.env.ENCRYPTION_KEY);
    const encrypted = await credentialEncryption.encrypt(data);
    return `${encrypted.iv}:${encrypted.ciphertext}`;
  }

  private async decrypt(encryptedData: string): Promise<string> {
    const { credentialEncryption } = await import('../crypto/encryption.js');
    await credentialEncryption.initialize(this.env.ENCRYPTION_KEY);
    
    const [iv, ciphertext] = encryptedData.split(':');
    if (!iv || !ciphertext) {
      throw new Error('Invalid encrypted data format');
    }
    
    return await credentialEncryption.decrypt({ iv, ciphertext });
  }
}