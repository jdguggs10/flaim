/// <reference types="@cloudflare/workers-types" />

import { EspnCredentials } from './types';
import { EspnKVStorage } from './kv-storage';

export interface Env {
  CF_KV_CREDENTIALS: KVNamespace;
  CF_ENCRYPTION_KEY: string;
  ESPN_S2?: string;
  ESPN_SWID?: string;
  NODE_ENV?: string;
  ENVIRONMENT?: string;
  CLERK_SECRET_KEY?: string;
}

export class EspnMcpProvider {
  constructor(private env: Env) {}

  // Get ESPN credentials for MCP tool execution
  async getEspnCredentials(clerkUserId: string): Promise<EspnCredentials | null> {
    if (!clerkUserId || clerkUserId === 'anonymous') {
      return this.getFallbackCredentials();
    }

    try {
      // Use KV storage instead of Durable Objects
      const kvStorage = new EspnKVStorage({
        kv: this.env.CF_KV_CREDENTIALS,
        encryptionKey: this.env.CF_ENCRYPTION_KEY
      });
      
      const credentials = await kvStorage.getCredentials(clerkUserId);
      
      if (credentials) {
        return credentials;
      }
      
      // Fallback to environment credentials if no user credentials
      return this.getFallbackCredentials();
    } catch (error) {
      console.error('Failed to get ESPN credentials for MCP:', error);
      return this.getFallbackCredentials();
    }
  }

  // Fallback credentials for development or anonymous access
  private getFallbackCredentials(): EspnCredentials | null {
    if (this.env.ENVIRONMENT === 'dev' && this.env.ESPN_S2 && this.env.ESPN_SWID) {
      console.log('⚠️ Development mode: Using fallback environment ESPN credentials');
      return {
        swid: this.env.ESPN_SWID,
        s2: this.env.ESPN_S2
      };
    }
    return null;
  }

  // Static method for external MCP services to get credentials
  static async getCredentialsForMcp(env: Env, clerkUserId: string): Promise<EspnCredentials | null> {
    const provider = new EspnMcpProvider(env);
    return provider.getEspnCredentials(clerkUserId);
  }
}