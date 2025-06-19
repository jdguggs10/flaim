import { Env } from './index';
import { EspnLeagueResponse } from './types/espn';
import { EspnCredentials } from '../../../auth/espn';

export class EspnApiClient {
  private baseUrl = 'https://fantasy.espn.com/apis/v3';
  
  constructor(private env: Env) {}

  async fetchLeague(leagueId: string, year: number = 2025, view: string = 'mSettings', clerkUserId?: string): Promise<EspnLeagueResponse> {
    const url = `${this.baseUrl}/games/flb/seasons/${year}/segments/0/leagues/${leagueId}?view=${view}`;
    
    const headers: Record<string, string> = {
      'User-Agent': 'baseball-espn-mcp/1.0',
      'Accept': 'application/json',
    };

    // Try to get user-specific ESPN credentials first
    let credentials: EspnCredentials | null = null;
    if (clerkUserId) {
      credentials = await this.getEspnCredentialsForUser(clerkUserId);
    }

    // Add authentication cookies if available (user-specific or development fallback)
    if (credentials) {
      headers['Cookie'] = `s2=${credentials.s2}; SWID=${credentials.swid}`;
    } else if (this.env.NODE_ENV === 'development' && this.env.ESPN_S2 && this.env.ESPN_SWID) {
      console.log('⚠️ Development mode: Using fallback environment ESPN credentials');
      headers['Cookie'] = `s2=${this.env.ESPN_S2}; SWID=${this.env.ESPN_SWID}`;
    }

    const response = await fetch(url, {
      headers,
      cf: { cacheEverything: false }
    });
    
    if (!response.ok) {
      // Handle ESPN-specific error codes
      if (response.status === 401) {
        throw new Error('ESPN authentication failed - check ESPN_S2 and ESPN_SWID credentials');
      }
      if (response.status === 429) {
        throw new Error('ESPN rate limit exceeded - please retry later');
      }
      if (response.status === 404) {
        throw new Error(`League ${leagueId} not found or not accessible`);
      }
      if (response.status === 403) {
        throw new Error(`Access denied to league ${leagueId} - may require authentication`);
      }
      throw new Error(`ESPN API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }

  async fetchRoster(leagueId: string, teamId: string, year: number = 2025, scoringPeriodId?: number, clerkUserId?: string) {
    let url = `${this.baseUrl}/games/flb/seasons/${year}/segments/0/leagues/${leagueId}?forTeamId=${teamId}&view=mRoster`;
    
    if (scoringPeriodId) {
      url += `&scoringPeriodId=${scoringPeriodId}`;
    }

    const headers: Record<string, string> = {
      'User-Agent': 'baseball-espn-mcp/1.0',
      'Accept': 'application/json',
    };

    // Try to get user-specific ESPN credentials first
    let credentials: EspnCredentials | null = null;
    if (clerkUserId) {
      credentials = await this.getEspnCredentialsForUser(clerkUserId);
    }

    // Authentication required for roster data
    if (credentials) {
      headers['Cookie'] = `s2=${credentials.s2}; SWID=${credentials.swid}`;
    } else if (this.env.NODE_ENV === 'development' && this.env.ESPN_S2 && this.env.ESPN_SWID) {
      console.log('⚠️ Development mode: Using fallback environment ESPN credentials');
      headers['Cookie'] = `s2=${this.env.ESPN_S2}; SWID=${this.env.ESPN_SWID}`;
    } else {
      throw new Error('ESPN authentication required for roster data - please provide ESPN credentials');
    }

    const response = await fetch(url, {
      headers,
      cf: { cacheEverything: false }
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('ESPN authentication failed - check ESPN_S2 and ESPN_SWID credentials');
      }
      if (response.status === 429) {
        throw new Error('ESPN rate limit exceeded - please retry later');
      }
      if (response.status === 404) {
        throw new Error(`Team ${teamId} not found in league ${leagueId}`);
      }
      throw new Error(`ESPN API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }

  // Helper method to get ESPN credentials for a specific user
  private async getEspnCredentialsForUser(clerkUserId: string): Promise<EspnCredentials | null> {
    try {
      const userStoreId = this.env.USER_DO.idFromString(clerkUserId);
      const userStore = this.env.USER_DO.get(userStoreId);
      
      // Create a request to get credentials
      const credentialRequest = new Request('https://dummy.com/credentials/espn', {
        method: 'GET',
        headers: {
          'X-Clerk-User-ID': clerkUserId
        }
      });
      
      const response = await userStore.fetch(credentialRequest);
      const data = await response.json() as any;
      
      if (data.hasCredentials) {
        // We need to call the internal API method to get the actual credentials
        // This is a workaround since we can't directly access the Durable Object methods
        const userCredentials = userStore as any;
        return await userCredentials.getEspnCredentialsForApi(clerkUserId);
      }
      
      return null;
    } catch (error) {
      console.error('Failed to get ESPN credentials for user:', error);
      return null;
    }
  }
}