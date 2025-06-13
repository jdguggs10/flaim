import { Env } from './index';
import { EspnLeagueResponse } from './types/espn';

export class EspnApiClient {
  private baseUrl = 'https://fantasy.espn.com/apis/v3';
  
  constructor(private env: Env) {}

  async fetchLeague(leagueId: string, year: number = 2025, view: string = 'mSettings'): Promise<EspnLeagueResponse> {
    const url = `${this.baseUrl}/games/flb/seasons/${year}/segments/0/leagues/${leagueId}?view=${view}`;
    
    const headers: Record<string, string> = {
      'User-Agent': 'baseball-espn-mcp/1.0',
      'Accept': 'application/json',
    };

    // Add authentication cookies if available
    if (this.env.ESPN_S2 && this.env.ESPN_SWID) {
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

  async fetchRoster(leagueId: string, teamId: string, year: number = 2025, scoringPeriodId?: number) {
    let url = `${this.baseUrl}/games/flb/seasons/${year}/segments/0/leagues/${leagueId}?forTeamId=${teamId}&view=mRoster`;
    
    if (scoringPeriodId) {
      url += `&scoringPeriodId=${scoringPeriodId}`;
    }

    const headers: Record<string, string> = {
      'User-Agent': 'baseball-espn-mcp/1.0',
      'Accept': 'application/json',
    };

    // Authentication required for roster data
    if (this.env.ESPN_S2 && this.env.ESPN_SWID) {
      headers['Cookie'] = `s2=${this.env.ESPN_S2}; SWID=${this.env.ESPN_SWID}`;
    } else {
      throw new Error('ESPN authentication required for roster data - please provide ESPN_S2 and ESPN_SWID');
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
}