/**
 * Auth Worker Utilities
 * 
 * Functions to communicate with the auth-worker for credential and league management
 */

export interface EspnCredentials {
  swid: string;
  s2: string;
  email?: string;
}

export interface AuthWorkerConfig {
  authWorkerUrl?: string;
  defaultUrl?: string;
}

/**
 * Fetch ESPN credentials from auth-worker for a given Clerk user ID
 * 
 * @param clerkUserId - The Clerk user ID  
 * @param config - Configuration for auth-worker URL
 * @returns ESPN credentials or null if not found
 */
export async function getCredentials(
  clerkUserId: string,
  config: AuthWorkerConfig = {}
): Promise<EspnCredentials | null> {
  try {
    // Use provided URL or default to local development
    const authWorkerUrl = config.authWorkerUrl || config.defaultUrl;
    const url = `${authWorkerUrl}/credentials/espn?raw=true`;
    
    console.log(`🔑 Fetching ESPN credentials for user ${clerkUserId} from ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Clerk-User-ID': clerkUserId,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`📡 Auth-worker response: ${response.status} ${response.statusText}`);
    
    if (response.status === 404) {
      console.log('ℹ️ No ESPN credentials found for user');
      return null;
    }
    
    if (!response.ok) {
      console.error(`❌ Auth-worker error: ${response.status} ${response.statusText}`);
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(`Auth-worker error: ${errorData.error || response.statusText}`);
    }
    
    const data = await response.json() as { success?: boolean; credentials?: EspnCredentials };
    
    if (!data.success || !data.credentials) {
      console.error('❌ Invalid response from auth-worker:', data);
      throw new Error('Invalid credentials response from auth-worker');
    }
    
    console.log('✅ Successfully retrieved ESPN credentials');
    return data.credentials;
    
  } catch (error) {
    console.error('❌ Failed to fetch credentials from auth-worker:', error);
    throw error;
  }
}

/**
 * Fetch user's leagues from auth-worker
 * 
 * @param clerkUserId - The Clerk user ID
 * @param config - Configuration for auth-worker URL  
 * @returns Array of leagues or empty array if none found
 */
export async function getUserLeagues(
  clerkUserId: string,
  config: AuthWorkerConfig = {}
): Promise<Array<{ leagueId: string; sport: string; teamId?: string }>> {
  try {
    const authWorkerUrl = config.authWorkerUrl || config.defaultUrl;
    const url = `${authWorkerUrl}/leagues`;
    
    console.log(`🏈 Fetching user leagues for ${clerkUserId} from ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Clerk-User-ID': clerkUserId,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`📡 Auth-worker leagues response: ${response.status} ${response.statusText}`);
    
    if (response.status === 404) {
      console.log('ℹ️ No leagues found for user');
      return [];
    }
    
    if (!response.ok) {
      console.error(`❌ Auth-worker leagues error: ${response.status} ${response.statusText}`);
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(`Auth-worker error: ${errorData.error || response.statusText}`);
    }
    
    const data = await response.json() as { success?: boolean; leagues?: Array<{ leagueId: string; sport: string; teamId?: string }> };
    
    if (!data.success) {
      console.error('❌ Invalid leagues response from auth-worker:', data);
      return [];
    }
    
    console.log(`✅ Successfully retrieved ${data.leagues?.length || 0} leagues`);
    return data.leagues || [];
    
  } catch (error) {
    console.error('❌ Failed to fetch leagues from auth-worker:', error);
    throw error;
  }
}