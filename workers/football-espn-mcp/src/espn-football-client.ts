import { EspnFootballLeagueResponse, EspnFootballTeamResponse, FootballTeam } from './types/espn-football';

// ESPN Credentials interface - local definition for HTTP calls
interface EspnCredentials {
  swid: string;
  s2: string;
  email?: string;
}

export interface Env {
  NODE_ENV?: string;
  ENVIRONMENT?: string;
  CLERK_SECRET_KEY?: string;
  AUTH_WORKER_URL: string;
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
    }

    const response = await fetch(url, {
      headers,
      cf: { cacheEverything: false }
    });
    
    if (!response.ok) {
      // Handle ESPN-specific error codes for football
      if (response.status === 401) {
        throw new Error('ESPN authentication failed - check auth-worker credentials');
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
    } else {
      throw new Error('ESPN authentication required for team data - please provide ESPN credentials');
    }

    const response = await fetch(url, {
      headers,
      cf: { cacheEverything: false }
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('ESPN authentication failed - check auth-worker credentials');
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
    }

    const response = await fetch(url, {
      headers,
      cf: { cacheEverything: false }
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('ESPN authentication failed - check auth-worker credentials');
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
    }

    const response = await fetch(url, {
      headers,
      cf: { cacheEverything: false }
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('ESPN authentication failed - check auth-worker credentials');
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
      // HTTP call to auth worker for credentials (stateless pattern)
      const authWorkerUrl = this.env.AUTH_WORKER_URL || 'http://localhost:8786';
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
      return null;
    }
  }
}