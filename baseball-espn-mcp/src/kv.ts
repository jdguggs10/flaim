// KV-based credential management following documented OAuth pattern
// Reference: Implementation plan.md section 4

export interface EspnCredentials {
  swid: string;
  espn_s2: string;
  email?: string;
  created_at: string;
  updated_at: string;
}

export class CredentialVault {
  constructor(private kv: KVNamespace) {}

  // Store credentials keyed by sub claim (OAuth pattern)
  async storeCredentials(sub: string, credentials: Omit<EspnCredentials, 'created_at' | 'updated_at'>): Promise<void> {
    const now = new Date().toISOString();
    const credentialData: EspnCredentials = {
      ...credentials,
      created_at: now,
      updated_at: now
    };

    await this.kv.put(`credentials:${sub}`, JSON.stringify(credentialData), {
      // Set expiration to 30 days (credentials should be refreshed periodically)
      expirationTtl: 30 * 24 * 60 * 60
    });
    
    console.log(`Stored credentials for sub: ${sub}`);
  }

  // Retrieve credentials for user
  async getCredentials(sub: string): Promise<EspnCredentials | null> {
    const data = await this.kv.get(`credentials:${sub}`);
    if (!data) {
      console.log(`No credentials found for sub: ${sub}`);
      return null;
    }

    try {
      const credentials = JSON.parse(data) as EspnCredentials;
      console.log(`Retrieved credentials for sub: ${sub}`);
      return credentials;
    } catch (error) {
      console.error(`Failed to parse credentials for sub ${sub}:`, error);
      return null;
    }
  }

  // Update existing credentials
  async updateCredentials(sub: string, updates: Partial<Omit<EspnCredentials, 'created_at' | 'updated_at'>>): Promise<boolean> {
    const existing = await this.getCredentials(sub);
    if (!existing) {
      console.log(`Cannot update credentials - sub not found: ${sub}`);
      return false;
    }

    const updated: EspnCredentials = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString()
    };

    await this.kv.put(`credentials:${sub}`, JSON.stringify(updated), {
      expirationTtl: 30 * 24 * 60 * 60
    });

    console.log(`Updated credentials for sub: ${sub}`);
    return true;
  }

  // Remove credentials (for user deletion/logout)
  async removeCredentials(sub: string): Promise<void> {
    await this.kv.delete(`credentials:${sub}`);
    console.log(`Removed credentials for sub: ${sub}`);
  }

  // Validate credentials exist and are not expired
  async validateCredentials(sub: string): Promise<boolean> {
    const credentials = await this.getCredentials(sub);
    if (!credentials) {
      return false;
    }

    // Check if credentials have required fields
    return !!(credentials.swid && credentials.espn_s2);
  }
}

// Helper function to extract sub from Authorization header
export function extractSubFromAuth(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    // In a real implementation, you would verify the JWT and extract the sub claim
    // For now, we'll use a simple approach - the token IS the sub for demo purposes
    const token = authHeader.slice(7); // Remove "Bearer "
    
    // TODO: Replace with proper JWT verification
    // const decoded = jwt.verify(token, JWT_SECRET);
    // return decoded.sub;
    
    // For demo: use the token as the sub directly
    return token;
  } catch (error) {
    console.error('Failed to extract sub from auth header:', error);
    return null;
  }
}

// ESPN API client using KV credentials (following documented pattern)
export async function fetchEspnWithCredentials(
  path: string, 
  sub: string, 
  vault: CredentialVault,
  init: RequestInit = {}
): Promise<Response> {
  const credentials = await vault.getCredentials(sub);
  if (!credentials) {
    throw new Error('No credentials found for user');
  }

  if (!credentials.swid || !credentials.espn_s2) {
    throw new Error('Invalid credentials - missing SWID or espn_s2');
  }

  const url = `https://fantasy.espn.com/apis/v3${path}`;
  
  return fetch(url, {
    ...init,
    headers: {
      'Cookie': `SWID=${credentials.swid}; espn_s2=${credentials.espn_s2}`,
      'User-Agent': 'baseball-espn-mcp/1.0',
      ...init.headers
    },
    cf: { cacheEverything: false }
  });
}