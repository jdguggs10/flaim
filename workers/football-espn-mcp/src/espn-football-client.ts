import { EspnCredentials, EspnMcpProvider } from '../../../auth/espn';
import { EspnFootballLeagueResponse } from './types/espn-football';

export interface Env {
  USER_DO: DurableObjectNamespace;
  ENCRYPTION_KEY: string;
  ESPN_S2?: string;
  ESPN_SWID?: string;
  NODE_ENV?: string;
}

export class EspnFootballApiClient {
  private baseUrl = 'https://fantasy.espn.com/apis/v3';
  
  constructor(private env: Env) {}

  async fetchLeague(leagueId: string, year: number = 2024, view: string = 'mSettings', clerkUserId?: string): Promise<EspnFootballLeagueResponse> {
    const url = `${this.baseUrl}/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?view=${view}`;
    
    const headers: Record<string, string> = {
      'User-Agent': 'football-espn-mcp/1.0',
      'Accept': 'application/json',
    };

    // Get ESPN credentials using shared auth module
    let credentials: EspnCredentials | null = null;
    if (clerkUserId) {
      credentials = await EspnMcpProvider.getCredentialsForMcp(this.env, clerkUserId);
    }

    // Add authentication cookies if available
    if (credentials) {
      headers['Cookie'] = `s2=${credentials.espn_s2}; SWID=${credentials.swid}`;
    } else if (this.env.NODE_ENV === 'development' && this.env.ESPN_S2 && this.env.ESPN_SWID) {
      console.log('⚠️ Development mode: Using fallback environment ESPN credentials for football');
      headers['Cookie'] = `s2=${this.env.ESPN_S2}; SWID=${this.env.ESPN_SWID}`;
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
      throw new Error(`ESPN Football API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }

  async fetchTeam(leagueId: string, teamId: string, year: number = 2024, scoringPeriodId?: number, clerkUserId?: string) {
    let url = `${this.baseUrl}/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?forTeamId=${teamId}&view=mRoster&view=mTeam`;
    
    if (scoringPeriodId) {
      url += `&scoringPeriodId=${scoringPeriodId}`;
    }

    const headers: Record<string, string> = {
      'User-Agent': 'football-espn-mcp/1.0',
      'Accept': 'application/json',
    };

    // Get ESPN credentials using shared auth module
    let credentials: EspnCredentials | null = null;
    if (clerkUserId) {
      credentials = await EspnMcpProvider.getCredentialsForMcp(this.env, clerkUserId);
    }

    // Authentication required for team/roster data
    if (credentials) {
      headers['Cookie'] = `s2=${credentials.espn_s2}; SWID=${credentials.swid}`;
    } else if (this.env.NODE_ENV === 'development' && this.env.ESPN_S2 && this.env.ESPN_SWID) {
      console.log('⚠️ Development mode: Using fallback environment ESPN credentials for football');
      headers['Cookie'] = `s2=${this.env.ESPN_S2}; SWID=${this.env.ESPN_SWID}`;
    } else {
      throw new Error('ESPN authentication required for football team data - please provide ESPN credentials');
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
        throw new Error(`Football team ${teamId} not found in league ${leagueId}`);
      }
      throw new Error(`ESPN Football API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }

  async fetchMatchups(leagueId: string, week?: number, year: number = 2024, clerkUserId?: string) {
    let url = `${this.baseUrl}/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?view=mMatchup`;
    
    if (week) {
      url += `&scoringPeriodId=${week}`;
    }

    const headers: Record<string, string> = {
      'User-Agent': 'football-espn-mcp/1.0',
      'Accept': 'application/json',
    };

    // Get ESPN credentials using shared auth module
    let credentials: EspnCredentials | null = null;
    if (clerkUserId) {
      credentials = await EspnMcpProvider.getCredentialsForMcp(this.env, clerkUserId);
    }

    // Add authentication cookies if available
    if (credentials) {
      headers['Cookie'] = `s2=${credentials.espn_s2}; SWID=${credentials.swid}`;
    } else if (this.env.NODE_ENV === 'development' && this.env.ESPN_S2 && this.env.ESPN_SWID) {
      console.log('⚠️ Development mode: Using fallback environment ESPN credentials for football');
      headers['Cookie'] = `s2=${this.env.ESPN_S2}; SWID=${this.env.ESPN_SWID}`;
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
        throw new Error(`Football league ${leagueId} not found or not accessible`);
      }
      throw new Error(`ESPN Football API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }

  async fetchStandings(leagueId: string, year: number = 2024, clerkUserId?: string) {
    const url = `${this.baseUrl}/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?view=mStandings`;
    
    const headers: Record<string, string> = {
      'User-Agent': 'football-espn-mcp/1.0',
      'Accept': 'application/json',
    };

    // Get ESPN credentials using shared auth module
    let credentials: EspnCredentials | null = null;
    if (clerkUserId) {
      credentials = await EspnMcpProvider.getCredentialsForMcp(this.env, clerkUserId);
    }

    // Add authentication cookies if available
    if (credentials) {
      headers['Cookie'] = `s2=${credentials.espn_s2}; SWID=${credentials.swid}`;
    } else if (this.env.NODE_ENV === 'development' && this.env.ESPN_S2 && this.env.ESPN_SWID) {
      console.log('⚠️ Development mode: Using fallback environment ESPN credentials for football');
      headers['Cookie'] = `s2=${this.env.ESPN_S2}; SWID=${this.env.ESPN_SWID}`;
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
        throw new Error(`Football league ${leagueId} not found or not accessible`);
      }
      throw new Error(`ESPN Football API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }
}