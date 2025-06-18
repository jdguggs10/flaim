/// <reference types="@cloudflare/workers-types" />

import { EspnCredentials } from './types';

export interface Env {
  USER_DO: DurableObjectNamespace;
  ENCRYPTION_KEY: string;
  ESPN_S2?: string;
  ESPN_SWID?: string;
  NODE_ENV?: string;
}

export class EspnMcpProvider {
  constructor(private env: Env) {}

  // Get ESPN credentials for MCP tool execution
  async getEspnCredentials(clerkUserId: string): Promise<EspnCredentials | null> {
    if (!clerkUserId || clerkUserId === 'anonymous') {
      return this.getFallbackCredentials();
    }

    try {
      const userStoreId = this.env.USER_DO.idFromString(clerkUserId);
      const userStore = this.env.USER_DO.get(userStoreId);
      
      const credentialRequest = new Request('https://dummy.com/credentials/espn', {
        method: 'GET',
        headers: {
          'X-Clerk-User-ID': clerkUserId
        }
      });
      
      const response = await userStore.fetch(credentialRequest);
      const data = await response.json() as any;
      
      if (data.hasCredentials) {
        const userCredentials = userStore as any;
        return await userCredentials.getEspnCredentialsForApi(clerkUserId);
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
    if (this.env.NODE_ENV === 'development' && this.env.ESPN_S2 && this.env.ESPN_SWID) {
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