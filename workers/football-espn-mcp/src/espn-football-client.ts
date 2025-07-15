import { EspnCredentials } from '../../../auth/espn';
import { EspnKVStorage } from '../../../auth/espn/kv-storage';
import { EspnFootballLeagueResponse, EspnFootballTeamResponse, FootballTeam } from './types/espn-football';

export interface Env {
  CF_KV_CREDENTIALS: KVNamespace;
  CF_ENCRYPTION_KEY: string;
  ESPN_S2?: string;
  ESPN_SWID?: string;
  NODE_ENV?: string;
  CLERK_SECRET_KEY?: string;
}

export class EspnFootballApiClient {
  private baseUrl = 'https://lm-api-reads.fantasy.espn.com/apis/v3';
  
  constructor(private env: Env) {}

  async fetchLeague(leagueId: string, year: number = 2024, view: string = 'mSettings', clerkUserId?: string): Promise<EspnFootballLeagueResponse> {
    const url = `${this.baseUrl}/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?view=${view}`;
    
    const headers: Record<string, string> = {
      'User-Agent': 'football-espn-mcp/1.0',
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-web-2.0.0'
    };

    // Get ESPN credentials using KV storage
    let credentials: EspnCredentials | null = null;
    if (clerkUserId) {
      credentials = await this.getEspnCredentialsForUser(clerkUserId);
    }

    // Add authentication cookies if available
    if (credentials) {
      headers['Cookie'] = `SWID=${credentials.swid}; espn_s2=${credentials.s2}`;
    } else if (this.env.ENVIRONMENT === 'dev' && this.env.ESPN_S2 && this.env.ESPN_SWID) {
      console.log('⚠️ Development mode: Using fallback environment ESPN credentials for football');
      headers['Cookie'] = `SWID=${this.env.ESPN_SWID}; espn_s2=${this.env.ESPN_S2}`;
    }

    const response = await fetch(url, {
      headers,
      cf: { cacheEverything: false }
    });
    
    if (!response.ok) {
      // Handle ESPN-specific error codes for football
      if (response.status === 401) {
        throw new Error('ESPN authentication failed - check ESPN_S2 and ESPN_SWID credentials');
      }
      if (response.status === 429) {
        throw new Error('ESPN rate limit exceeded - please retry later');
      }
      if (response.status === 404) {
        throw new Error(`Football league ${leagueId} not found or not accessible`);
      }
      if (response.status === 403) {
        throw new Error(`Access denied to football league ${leagueId} - may require authentication`);
      }
      
      const errorText = await response.text();
      throw new Error(`ESPN Football API error ${response.status}: ${errorText}`);
    }

    return await response.json();
  }

  async fetchTeam(leagueId: string, teamId: string, year: number = 2024, week?: number, clerkUserId?: string): Promise<FootballTeam> {
    let url = `${this.baseUrl}/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?view=mRoster`;
    if (week) {
      url += `&scoringPeriodId=${week}`;
    }
    
    const headers: Record<string, string> = {
      'User-Agent': 'football-espn-mcp/1.0',
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-web-2.0.0'
    };

    // Get user credentials for team data
    let credentials: EspnCredentials | null = null;
    if (clerkUserId) {
      credentials = await this.getEspnCredentialsForUser(clerkUserId);
    }

    // Authentication required for team data
    if (credentials) {
      headers['Cookie'] = `SWID=${credentials.swid}; espn_s2=${credentials.s2}`;
    } else if (this.env.ENVIRONMENT === 'dev' && this.env.ESPN_S2 && this.env.ESPN_SWID) {
      console.log('⚠️ Development mode: Using fallback environment ESPN credentials');
      headers['Cookie'] = `SWID=${this.env.ESPN_SWID}; espn_s2=${this.env.ESPN_S2}`;
    } else {
      throw new Error('ESPN authentication required for team data - please provide ESPN credentials');
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
        throw new Error(`Football league ${leagueId} or team ${teamId} not found`);
      }
      if (response.status === 403) {
        throw new Error(`Access denied to football league ${leagueId} team data`);
      }
      
      const errorText = await response.text();
      throw new Error(`ESPN Football API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as EspnFootballTeamResponse;
    
    // Filter to the specific team if teamId is provided
    if (teamId && data.teams) {
      const team = data.teams.find((t: FootballTeam) => t.id.toString() === teamId);
      if (!team) {
        throw new Error(`Team ${teamId} not found in football league ${leagueId}`);
      }
      return team;
    }
    
    // If no specific teamId requested, return the first team or throw error
    if (data.teams && data.teams.length > 0) {
      return data.teams[0];
    }
    
    throw new Error(`No teams found in football league ${leagueId}`);
  }

  async fetchMatchups(leagueId: string, week?: number, year: number = 2024, clerkUserId?: string): Promise<any> {
    let url = `${this.baseUrl}/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?view=mMatchup`;
    if (week) {
      url += `&scoringPeriodId=${week}`;
    }
    
    const headers: Record<string, string> = {
      'User-Agent': 'football-espn-mcp/1.0',
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-web-2.0.0'
    };

    // Get user credentials
    let credentials: EspnCredentials | null = null;
    if (clerkUserId) {
      credentials = await this.getEspnCredentialsForUser(clerkUserId);
    }

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
      if (response.status === 401) {
        throw new Error('ESPN authentication failed - check ESPN_S2 and ESPN_SWID credentials');
      }
      if (response.status === 429) {
        throw new Error('ESPN rate limit exceeded - please retry later');
      }
      if (response.status === 404) {
        throw new Error(`Football league ${leagueId} not found`);
      }
      if (response.status === 403) {
        throw new Error(`Access denied to football league ${leagueId} matchup data`);
      }
      
      const errorText = await response.text();
      throw new Error(`ESPN Football API error ${response.status}: ${errorText}`);
    }

    return await response.json();
  }

  async fetchStandings(leagueId: string, year: number = 2024, clerkUserId?: string): Promise<any> {
    const url = `${this.baseUrl}/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?view=mStandings`;
    
    const headers: Record<string, string> = {
      'User-Agent': 'football-espn-mcp/1.0',
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-web-2.0.0'
    };

    // Get user credentials
    let credentials: EspnCredentials | null = null;
    if (clerkUserId) {
      credentials = await this.getEspnCredentialsForUser(clerkUserId);
    }

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
      if (response.status === 401) {
        throw new Error('ESPN authentication failed - check ESPN_S2 and ESPN_SWID credentials');
      }
      if (response.status === 429) {
        throw new Error('ESPN rate limit exceeded - please retry later');
      }
      if (response.status === 404) {
        throw new Error(`Football league ${leagueId} not found`);
      }
      if (response.status === 403) {
        throw new Error(`Access denied to football league ${leagueId} standings`);
      }
      
      const errorText = await response.text();
      throw new Error(`ESPN Football API error ${response.status}: ${errorText}`);
    }

    return await response.json();
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