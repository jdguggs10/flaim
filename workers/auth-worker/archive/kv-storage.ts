/**
 * CF KV-based ESPN Credential Storage
 * ---------------------------------------------------------------------------
 * 
 * Replaces Durable Object storage with Cloudflare KV for credential storage.
 * Uses CF Secrets for encryption key management.
 * 
 * Environment Variables Required:
 * - CF_KV_CREDENTIALS_NAMESPACE: KV namespace binding
 * - CF_ENCRYPTION_KEY: Base64 encryption key (stored in CF Secrets)
 * 
 * @version 1.0 - CF KV implementation
 */

import { credentialEncryption } from './encryption';
import { EspnCredentials, EspnCredentialsWithMetadata, EspnLeague, EspnUserData } from './espn-types';

export interface EspnKVOptions {
  kv?: KVNamespace;        // Cloudflare Workers KV binding
  envVarName?: string;     // Node.js/Next.js environment variable name
  encryptionKey: string;   // Base64 encryption key
}

// Legacy interface for backward compatibility
export interface CFKVEnvironment {
  CF_KV_CREDENTIALS: KVNamespace;
  CF_ENCRYPTION_KEY: string;
}

export class EspnKVStorage {
  private kvNamespace: KVNamespace;
  private encryptionKey: string;

  constructor(options: EspnKVOptions | CFKVEnvironment) {
    // Handle new options interface
    if ('kv' in options || 'envVarName' in options) {
      const opts = options as EspnKVOptions;
      
      if (opts.kv) {
        // Cloudflare Workers environment - KV binding provided
        this.kvNamespace = opts.kv;
      } else if (opts.envVarName) {
        // Node.js/Next.js environment - get KV from environment variable
        const kvEnv = process.env[opts.envVarName];
        if (!kvEnv) {
          throw new Error(`Environment variable ${opts.envVarName} not found`);
        }
        // In local development/test, allow mock KV for testing
        if (process.env.ENVIRONMENT === 'dev' || process.env.NODE_ENV === 'test') {
          // Mock KV will be injected by test setup
          this.kvNamespace = kvEnv as any;
        } else {
          // In Node.js production, we'd need to create a KV client - this is a placeholder
          throw new Error('Node.js KV client not implemented yet - use CF Workers');
        }
      } else {
        throw new Error('Either kv or envVarName must be provided');
      }
      
      this.encryptionKey = opts.encryptionKey;
    } else {
      // Legacy CFKVEnvironment interface for backward compatibility
      const env = options as CFKVEnvironment;
      this.kvNamespace = env.CF_KV_CREDENTIALS;
      this.encryptionKey = env.CF_ENCRYPTION_KEY;
    }
  }

  // =============================================================================
  // CORE CREDENTIAL OPERATIONS
  // =============================================================================

  /**
   * Store encrypted ESPN credentials for a user
   */
  async setCredentials(clerkUserId: string, swid: string, s2: string, email?: string): Promise<boolean> {
    try {
      if (!clerkUserId || !swid || !s2) {
        throw new Error('Missing required parameters: clerkUserId, swid, s2');
      }

      const now = new Date().toISOString();
      const credentials: EspnCredentialsWithMetadata = {
        clerkUserId,
        swid,
        s2,
        espn_s2: s2, // Alias for backward compatibility
        email,
        created_at: now,
        updated_at: now
      };

      const encrypted = await this.encrypt(JSON.stringify(credentials));
      const key = this.getCredentialKey(clerkUserId);
      
      await this.kvNamespace.put(key, encrypted, {
        metadata: {
          clerkUserId,
          lastUpdated: now,
          hasEmail: !!email
        }
      });

      return true;
    } catch (error) {
      console.error('Failed to store ESPN credentials:', error);
      return false;
    }
  }

  /**
   * Store ESPN credentials for a user (backward compatibility method)
   * @param clerkUserId - Clerk user ID
   * @param credentials - ESPN credentials object with swid, espn_s2, and optional email
   */
  async setEspnCredentialsForUser(clerkUserId: string, credentials: { swid: string; espn_s2: string; email?: string }): Promise<boolean> {
    return this.setCredentials(clerkUserId, credentials.swid, credentials.espn_s2, credentials.email);
  }

  /**
   * Store league IDs and sports for a user
   * @param clerkUserId - Clerk user ID
   * @param leagues - Array of league objects with leagueId and sport
   */
  async setUserLeagues(clerkUserId: string, leagues: Array<{ leagueId: string; sport: string }>): Promise<boolean> {
    try {
      if (!clerkUserId || !leagues) {
        throw new Error('Missing required parameters: clerkUserId, leagues');
      }

      const now = new Date().toISOString();
      const leagueData = {
        clerkUserId,
        leagues,
        updated_at: now,
        created_at: now
      };

      const encrypted = await this.encrypt(JSON.stringify(leagueData));
      const key = this.getLeagueKey(clerkUserId);
      
      await this.kvNamespace.put(key, encrypted, {
        metadata: {
          clerkUserId,
          lastUpdated: now,
          leagueCount: leagues.length
        }
      });

      return true;
    } catch (error) {
      console.error('Failed to store user leagues:', error);
      return false;
    }
  }

  /**
   * Retrieve user leagues
   * @param clerkUserId - Clerk user ID
   */
  async getUserLeagues(clerkUserId: string): Promise<Array<{ leagueId: string; sport: string }> | null> {
    try {
      if (!clerkUserId) return null;

      const key = this.getLeagueKey(clerkUserId);
      const encrypted = await this.kvNamespace.get(key);
      
      if (!encrypted) return null;

      const decrypted = await this.decrypt(encrypted);
      const leagueData = JSON.parse(decrypted) as {
        clerkUserId: string;
        leagues: Array<{ leagueId: string; sport: string }>;
        updated_at: string;
        created_at: string;
      };
      
      return leagueData.leagues || [];
    } catch (error) {
      console.error('Failed to retrieve user leagues:', error);
      return null;
    }
  }

  /**
   * Retrieve and decrypt ESPN credentials for a user
   */
  async getCredentials(clerkUserId: string): Promise<EspnCredentials | null> {
    try {
      if (!clerkUserId) return null;

      const key = this.getCredentialKey(clerkUserId);
      const encrypted = await this.kvNamespace.get(key);
      
      if (!encrypted) return null;

      const decrypted = await this.decrypt(encrypted);
      const fullCredentials = JSON.parse(decrypted) as EspnCredentialsWithMetadata;
      
      // Return only core credential fields
      return {
        swid: fullCredentials.swid,
        s2: fullCredentials.s2 || fullCredentials.espn_s2 || ''
      };
    } catch (error) {
      console.error('Failed to retrieve ESPN credentials:', error);
      return null;
    }
  }

  /**
   * Get full credential metadata (without sensitive data)
   */
  async getCredentialMetadata(clerkUserId: string): Promise<{ hasCredentials: boolean; email?: string; lastUpdated?: string } | null> {
    try {
      if (!clerkUserId) return null;

      const key = this.getCredentialKey(clerkUserId);
      const { value: encrypted, metadata } = await this.kvNamespace.getWithMetadata(key);
      
      if (!encrypted) {
        return { hasCredentials: false };
      }

      return {
        hasCredentials: true,
        email: (metadata as any)?.hasEmail ? 'Available' : undefined,
        lastUpdated: (metadata as any)?.lastUpdated as string
      };
    } catch (error) {
      console.error('Failed to get credential metadata:', error);
      return { hasCredentials: false };
    }
  }

  /**
   * Check if user has credentials without decrypting
   */
  async hasCredentials(clerkUserId: string): Promise<boolean> {
    try {
      if (!clerkUserId) return false;
      
      const key = this.getCredentialKey(clerkUserId);
      const value = await this.kvNamespace.get(key);
      return !!value;
    } catch (error) {
      console.error('Failed to check credentials:', error);
      return false;
    }
  }

  /**
   * Delete ESPN credentials for a user
   */
  async deleteCredentials(clerkUserId: string): Promise<boolean> {
    try {
      if (!clerkUserId) return false;
      
      const credentialKey = this.getCredentialKey(clerkUserId);
      const leagueKey = this.getLeagueKey(clerkUserId);
      
      // Delete both credentials and leagues
      await Promise.all([
        this.kvNamespace.delete(credentialKey),
        this.kvNamespace.delete(leagueKey)
      ]);
      
      return true;
    } catch (error) {
      console.error('Failed to delete ESPN credentials:', error);
      return false;
    }
  }

  // =============================================================================
  // LEAGUE MANAGEMENT OPERATIONS
  // =============================================================================

  /**
   * Store ESPN leagues for a user
   */
  async setLeagues(clerkUserId: string, leagues: EspnLeague[]): Promise<boolean> {
    try {
      if (!clerkUserId) return false;
      
      if (leagues.length > 10) {
        throw new Error('Maximum of 10 leagues allowed per user');
      }

      const userData: EspnUserData = {
        espnLeagues: leagues,
        maxLeagues: 10
      };

      const encrypted = await this.encrypt(JSON.stringify(userData));
      const key = this.getLeagueKey(clerkUserId);
      
      await this.kvNamespace.put(key, encrypted, {
        metadata: {
          clerkUserId,
          leagueCount: leagues.length,
          lastUpdated: new Date().toISOString(),
          sports: [...new Set(leagues.map(l => l.sport))]
        }
      });

      return true;
    } catch (error) {
      console.error('Failed to store ESPN leagues:', error);
      return false;
    }
  }

  /**
   * Retrieve ESPN leagues for a user
   */
  async getLeagues(clerkUserId: string): Promise<EspnLeague[]> {
    try {
      if (!clerkUserId) return [];

      const key = this.getLeagueKey(clerkUserId);
      const encrypted = await this.kvNamespace.get(key);
      
      if (!encrypted) return [];

      const decrypted = await this.decrypt(encrypted);
      const userData = JSON.parse(decrypted) as EspnUserData;
      
      return userData.espnLeagues || [];
    } catch (error) {
      console.error('Failed to retrieve ESPN leagues:', error);
      return [];
    }
  }

  /**
   * Add a single league to user's collection
   */
  async addLeague(clerkUserId: string, league: EspnLeague): Promise<boolean> {
    try {
      const existingLeagues = await this.getLeagues(clerkUserId);
      
      // Check for duplicates
      const isDuplicate = existingLeagues.some(
        existing => existing.leagueId === league.leagueId && existing.sport === league.sport
      );
      
      if (isDuplicate) {
        throw new Error(`League ${league.leagueId} for ${league.sport} already exists`);
      }
      
      // Check league limit
      if (existingLeagues.length >= 10) {
        throw new Error('Maximum of 10 leagues allowed per user');
      }
      
      const updatedLeagues = [...existingLeagues, league];
      return await this.setLeagues(clerkUserId, updatedLeagues);
    } catch (error) {
      console.error('Failed to add ESPN league:', error);
      return false;
    }
  }

  /**
   * Remove a league from user's collection
   */
  async removeLeague(clerkUserId: string, leagueId: string, sport: string): Promise<boolean> {
    try {
      const existingLeagues = await this.getLeagues(clerkUserId);
      const filteredLeagues = existingLeagues.filter(
        league => !(league.leagueId === leagueId && league.sport === sport)
      );
      
      return await this.setLeagues(clerkUserId, filteredLeagues);
    } catch (error) {
      console.error('Failed to remove ESPN league:', error);
      return false;
    }
  }

  /**
   * Update a specific league (e.g., add teamId after auto-pull)
   */
  async updateLeague(clerkUserId: string, leagueId: string, updates: Partial<EspnLeague>): Promise<boolean> {
    try {
      const existingLeagues = await this.getLeagues(clerkUserId);
      const updatedLeagues = existingLeagues.map(league => 
        league.leagueId === leagueId ? { ...league, ...updates } : league
      );
      
      return await this.setLeagues(clerkUserId, updatedLeagues);
    } catch (error) {
      console.error('Failed to update ESPN league:', error);
      return false;
    }
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  /**
   * Get all data for a user (credentials + leagues)
   */
  async getUserData(clerkUserId: string): Promise<{ 
    hasCredentials: boolean; 
    leagues: EspnLeague[]; 
    metadata?: any 
  }> {
    try {
      const [hasCredentials, leagues, metadata] = await Promise.all([
        this.hasCredentials(clerkUserId),
        this.getLeagues(clerkUserId),
        this.getCredentialMetadata(clerkUserId)
      ]);

      return {
        hasCredentials,
        leagues,
        metadata
      };
    } catch (error) {
      console.error('Failed to get user data:', error);
      return {
        hasCredentials: false,
        leagues: []
      };
    }
  }

  // =============================================================================
  // STATIC FACTORY METHODS
  // =============================================================================

  /**
   * Create instance from CF Worker environment
   */
  static fromEnvironment(env: CFKVEnvironment): EspnKVStorage {
    return new EspnKVStorage(env);
  }

  /**
   * Create instance for MCP workers
   */
  static async getCredentialsForMcp(env: CFKVEnvironment, clerkUserId: string): Promise<EspnCredentials | null> {
    const storage = new EspnKVStorage(env);
    return await storage.getCredentials(clerkUserId);
  }

  // =============================================================================
  // KV CONSISTENCY HELPERS
  // =============================================================================

  /**
   * Retry read operation with backoff for eventual consistency
   * Useful when you need to read immediately after a write operation
   */
  async retryReadWithBackoff<T>(
    readOperation: () => Promise<T>, 
    validateResult: (result: T) => boolean,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
  ): Promise<T> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = await readOperation();
      
      if (validateResult(result)) {
        return result;
      }
      
      if (attempt < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // Final attempt without delay
    return await readOperation();
  }

  // =============================================================================
  // PRIVATE HELPER METHODS
  // =============================================================================

  private getCredentialKey(clerkUserId: string): string {
    return `espn_creds:${clerkUserId}`;
  }

  private getLeagueKey(clerkUserId: string): string {
    return `espn_leagues:${clerkUserId}`;
  }

  private async encrypt(data: string): Promise<string> {
    await credentialEncryption.initialize(this.encryptionKey);
    const encrypted = await credentialEncryption.encrypt(data);
    // Format: keyId:iv:ciphertext (backward compatible with old iv:ciphertext format)
    return encrypted.keyId ? `${encrypted.keyId}:${encrypted.iv}:${encrypted.ciphertext}` : `${encrypted.iv}:${encrypted.ciphertext}`;
  }

  private async decrypt(encryptedData: string): Promise<string> {
    await credentialEncryption.initialize(this.encryptionKey);
    
    const parts = encryptedData.split(':');
    let keyId: string | undefined;
    let iv: string;
    let ciphertext: string;
    
    if (parts.length === 3) {
      // New format: keyId:iv:ciphertext
      [keyId, iv, ciphertext] = parts;
    } else if (parts.length === 2) {
      // Legacy format: iv:ciphertext
      [iv, ciphertext] = parts;
    } else {
      throw new Error('Invalid encrypted data format');
    }
    
    if (!iv || !ciphertext) {
      throw new Error('Invalid encrypted data format');
    }

    // TODO: Handle key rotation - for now, assume current key can decrypt all data
    return await credentialEncryption.decrypt({ iv, ciphertext, keyId });
  }
}

// =============================================================================
// HTTP RESPONSE HELPERS FOR API ROUTES
// =============================================================================

export class EspnKVStorageAPI {
  constructor(private storage: EspnKVStorage) {}

  /**
   * Handle GET /api/espn/credentials
   */
  async handleGetCredentials(clerkUserId: string): Promise<Response> {
    try {
      const metadata = await this.storage.getCredentialMetadata(clerkUserId);
      
      if (!metadata?.hasCredentials) {
        return Response.json({
          hasCredentials: false,
          message: 'No ESPN credentials found'
        }, { status: 404 });
      }

      return Response.json({
        hasCredentials: true,
        email: metadata.email,
        lastUpdated: metadata.lastUpdated
      });
    } catch (error) {
      return Response.json({
        error: 'Failed to retrieve credentials',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
  }

  /**
   * Handle POST/PUT /api/espn/credentials
   */
  async handleSetCredentials(clerkUserId: string, body: { swid: string; s2: string; email?: string }): Promise<Response> {
    try {
      const { swid, s2, email } = body;
      
      if (!swid || !s2) {
        return Response.json({
          error: 'Missing required fields: swid, s2'
        }, { status: 400 });
      }

      const success = await this.storage.setCredentials(clerkUserId, swid, s2, email);
      
      if (!success) {
        return Response.json({
          error: 'Failed to store credentials'
        }, { status: 500 });
      }

      return Response.json({
        success: true,
        message: 'ESPN credentials stored successfully'
      });
    } catch (error) {
      return Response.json({
        error: 'Failed to store credentials',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
  }

  /**
   * Handle DELETE /api/espn/credentials
   */
  async handleDeleteCredentials(clerkUserId: string): Promise<Response> {
    try {
      const success = await this.storage.deleteCredentials(clerkUserId);
      
      if (!success) {
        return Response.json({
          error: 'Failed to delete credentials'
        }, { status: 500 });
      }

      return Response.json({
        success: true,
        message: 'ESPN credentials deleted successfully'
      });
    } catch (error) {
      return Response.json({
        error: 'Failed to delete credentials',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
  }

  /**
   * Handle GET /api/espn/leagues
   */
  async handleGetLeagues(clerkUserId: string): Promise<Response> {
    try {
      const leagues = await this.storage.getLeagues(clerkUserId);
      
      return Response.json({
        success: true,
        leagues,
        totalLeagues: leagues.length
      });
    } catch (error) {
      return Response.json({
        error: 'Failed to retrieve leagues',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
  }

  /**
   * Handle POST /api/espn/leagues
   */
  async handleSetLeagues(clerkUserId: string, body: { leagues: EspnLeague[] }): Promise<Response> {
    try {
      const { leagues } = body;
      
      if (!Array.isArray(leagues)) {
        return Response.json({
          error: 'Invalid request: leagues array is required'
        }, { status: 400 });
      }

      const success = await this.storage.setLeagues(clerkUserId, leagues);
      
      if (!success) {
        return Response.json({
          error: 'Failed to store leagues'
        }, { status: 500 });
      }

      return Response.json({
        success: true,
        message: 'ESPN leagues stored successfully',
        totalLeagues: leagues.length
      });
    } catch (error) {
      return Response.json({
        error: 'Failed to store leagues',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
  }
}