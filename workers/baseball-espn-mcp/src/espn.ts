import { Env } from './index';
import { EspnLeagueResponse, EspnRosterResponse, EspnTeam } from './types/espn';
import { EspnCredentials } from '../../../auth/espn';
import { EspnKVStorage } from '../../../auth/espn/kv-storage';

export class EspnApiClient {
  private baseUrl = 'https://lm-api-reads.fantasy.espn.com/apis/v3';
  
  constructor(private env: Env) {}

  async fetchLeague(leagueId: string, year: number = 2025, view: string = 'mSettings', clerkUserId?: string): Promise<EspnLeagueResponse> {
    const url = `${this.baseUrl}/games/flb/seasons/${year}/segments/0/leagues/${leagueId}?view=${view}`;
    
    const headers: Record<string, string> = {
      'User-Agent': 'baseball-espn-mcp/1.0',
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-web-2.0.0'
    };

    // Try to get user-specific ESPN credentials first
    let credentials: EspnCredentials | null = null;
    if (clerkUserId) {
      credentials = await this.getEspnCredentialsForUser(clerkUserId);
    }

    // Add authentication cookies if available (user-specific or development fallback)
    if (credentials) {
      headers['Cookie'] = `SWID=${credentials.swid}; espn_s2=${credentials.s2}`;
    } else if (this.env.ENVIRONMENT === 'dev' && this.env.ESPN_S2 && this.env.ESPN_SWID) {
      console.log('⚠️ Development mode: Using fallback environment ESPN credentials');
      headers['Cookie'] = `SWID=${this.env.ESPN_SWID}; espn_s2=${this.env.ESPN_S2}`;
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
      
      const errorText = await response.text();
      throw new Error(`ESPN API error ${response.status}: ${errorText}`);
    }

    return await response.json();
  }

  async fetchRoster(leagueId: string, teamId: string, year: number = 2025, week?: number, clerkUserId?: string): Promise<EspnTeam> {
    let url = `${this.baseUrl}/games/flb/seasons/${year}/segments/0/leagues/${leagueId}?view=mRoster`;
    if (week) {
      url += `&scoringPeriodId=${week}`;
    }
    
    const headers: Record<string, string> = {
      'User-Agent': 'baseball-espn-mcp/1.0',
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-web-2.0.0'
    };

    // Get user credentials for roster data (typically requires authentication)
    let credentials: EspnCredentials | null = null;
    if (clerkUserId) {
      credentials = await this.getEspnCredentialsForUser(clerkUserId);
    }

    // Authentication required for roster data
    if (credentials) {
      headers['Cookie'] = `SWID=${credentials.swid}; espn_s2=${credentials.s2}`;
    } else if (this.env.ENVIRONMENT === 'dev' && this.env.ESPN_S2 && this.env.ESPN_SWID) {
      console.log('⚠️ Development mode: Using fallback environment ESPN credentials');
      headers['Cookie'] = `SWID=${this.env.ESPN_SWID}; espn_s2=${this.env.ESPN_S2}`;
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
        throw new Error(`League ${leagueId} or team ${teamId} not found`);
      }
      if (response.status === 403) {
        throw new Error(`Access denied to league ${leagueId} roster data`);
      }
      
      const errorText = await response.text();
      throw new Error(`ESPN API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as EspnRosterResponse;
    
    // Filter to the specific team if teamId is provided
    if (teamId && data.teams) {
      const team = data.teams.find((t: EspnTeam) => t.id.toString() === teamId);
      if (!team) {
        throw new Error(`Team ${teamId} not found in league ${leagueId}`);
      }
      return team;
    }
    
    // If no specific teamId requested, return the first team or throw error
    if (data.teams && data.teams.length > 0) {
      return data.teams[0];
    }
    
    throw new Error(`No teams found in league ${leagueId}`);
  }

  /**
   * Get ESPN credentials from KV storage
   */
  private async getEspnCredentialsForUser(clerkUserId: string): Promise<EspnCredentials | null> {
    try {
      const kvStorage = new EspnKVStorage({
        kv: this.env.CF_KV_CREDENTIALS,
        encryptionKey: this.env.CF_ENCRYPTION_KEY
      });
      
      return await kvStorage.getCredentials(clerkUserId);
    } catch (error) {
      console.error('Failed to get ESPN credentials from KV:', error);
      return null;
    }
  }
}