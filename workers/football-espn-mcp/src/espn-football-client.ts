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
  AUTH_WORKER_URL: string;
  AUTH_WORKER?: Fetcher;  // Service Binding for auth-worker
}

export class EspnFootballApiClient {
  private baseUrl = 'https://lm-api-reads.fantasy.espn.com/apis/v3';
  private authHeader?: string | null;
  private logContext?: { resolvedUserId?: string };

  constructor(private env: Env, opts?: { authHeader?: string | null; logContext?: { resolvedUserId?: string } }) {
    this.authHeader = opts?.authHeader;
    this.logContext = opts?.logContext;
  }

  async fetchLeague(leagueId: string, year: number = 2024, view: string = 'mSettings', clerkUserId?: string): Promise<EspnFootballLeagueResponse> {
    const url = `${this.baseUrl}/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?view=${view}`;

    const headers: Record<string, string> = {
      'User-Agent': 'football-espn-mcp/1.0',
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-web-2.0.0'
    };

    // Get ESPN credentials from auth-worker (optional - public leagues work without)
    if (clerkUserId && clerkUserId !== 'anonymous' && this.authHeader) {
      const credentials = await this.getEspnCredentialsForUser(clerkUserId);
      if (credentials) {
        headers['Cookie'] = `SWID=${credentials.swid}; espn_s2=${credentials.s2}`;
      }
    }

    const response = await fetch(url, {
      headers,
      cf: { cacheEverything: false }
    });

    if (!response.ok) {
      // Handle ESPN-specific error codes for football
      if (response.status === 401) {
        throw new Error('ESPN_COOKIES_EXPIRED: Your ESPN cookies may have expired. Update them at /settings/espn');
      }
      if (response.status === 429) {
        throw new Error('ESPN_RATE_LIMIT: ESPN rate limit exceeded. Please wait a moment and try again.');
      }
      if (response.status === 404) {
        throw new Error(`ESPN_NOT_FOUND: Football league ${leagueId} not found. Please check the league ID.`);
      }
      if (response.status === 403) {
        throw new Error(`ESPN_ACCESS_DENIED: Access denied to football league ${leagueId}. This league may be private - set up your ESPN credentials at /settings/espn.`);
      }

      throw new Error(`ESPN_API_ERROR: ESPN returned error ${response.status}. Please try again.`);
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

    // Authentication required for team data
    if (!clerkUserId || clerkUserId === 'anonymous') {
      throw new Error('ESPN_AUTH_REQUIRED: User authentication required for team data. Please sign in and try again.');
    }
    if (!this.authHeader) {
      throw new Error('ESPN_AUTH_REQUIRED: Authorization header missing. Please refresh the page and try again.');
    }

    const credentials = await this.getEspnCredentialsForUser(clerkUserId);
    if (!credentials) {
      throw new Error('ESPN_CREDENTIALS_NOT_FOUND: No ESPN credentials found. Add your espn_s2 and SWID cookies at /settings/espn');
    }
    headers['Cookie'] = `SWID=${credentials.swid}; espn_s2=${credentials.s2}`;

    const response = await fetch(url, {
      headers,
      cf: { cacheEverything: false }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('ESPN_COOKIES_EXPIRED: Your ESPN cookies may have expired. Update them at /settings/espn');
      }
      if (response.status === 429) {
        throw new Error('ESPN_RATE_LIMIT: ESPN rate limit exceeded. Please wait a moment and try again.');
      }
      if (response.status === 404) {
        throw new Error(`ESPN_NOT_FOUND: Football league ${leagueId} or team ${teamId} not found.`);
      }
      if (response.status === 403) {
        throw new Error(`ESPN_ACCESS_DENIED: Access denied to football league ${leagueId}. Make sure you're a member of this league.`);
      }

      throw new Error(`ESPN_API_ERROR: ESPN returned error ${response.status}. Please try again.`);
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

    // Get user credentials for matchup data (optional - public leagues work without)
    if (clerkUserId && clerkUserId !== 'anonymous' && this.authHeader) {
      const credentials = await this.getEspnCredentialsForUser(clerkUserId);
      if (credentials) {
        headers['Cookie'] = `SWID=${credentials.swid}; espn_s2=${credentials.s2}`;
      }
    }

    const response = await fetch(url, {
      headers,
      cf: { cacheEverything: false }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('ESPN_COOKIES_EXPIRED: Your ESPN cookies may have expired. Update them at /settings/espn');
      }
      if (response.status === 429) {
        throw new Error('ESPN_RATE_LIMIT: ESPN rate limit exceeded. Please wait a moment and try again.');
      }
      if (response.status === 404) {
        throw new Error(`ESPN_NOT_FOUND: Football league ${leagueId} not found. Please check the league ID.`);
      }
      if (response.status === 403) {
        throw new Error(`ESPN_ACCESS_DENIED: Access denied to football league ${leagueId} matchup data. Set up your ESPN credentials at /settings/espn.`);
      }

      throw new Error(`ESPN_API_ERROR: ESPN returned error ${response.status}. Please try again.`);
    }

    return await response.json();
  }

  async fetchStandings(leagueId: string, year: number = 2024, clerkUserId?: string): Promise<any> {
    const url = `${this.baseUrl}/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?view=mStandings&view=mTeam`;

    const headers: Record<string, string> = {
      'User-Agent': 'football-espn-mcp/1.0',
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-web-2.0.0'
    };

    // Get user credentials for standings data (optional - public leagues work without)
    if (clerkUserId && clerkUserId !== 'anonymous' && this.authHeader) {
      const credentials = await this.getEspnCredentialsForUser(clerkUserId);
      if (credentials) {
        headers['Cookie'] = `SWID=${credentials.swid}; espn_s2=${credentials.s2}`;
      }
    }

    const response = await fetch(url, {
      headers,
      cf: { cacheEverything: false }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('ESPN_COOKIES_EXPIRED: Your ESPN cookies may have expired. Update them at /settings/espn');
      }
      if (response.status === 429) {
        throw new Error('ESPN_RATE_LIMIT: ESPN rate limit exceeded. Please wait a moment and try again.');
      }
      if (response.status === 404) {
        throw new Error(`ESPN_NOT_FOUND: Football league ${leagueId} not found. Please check the league ID.`);
      }
      if (response.status === 403) {
        throw new Error(`ESPN_ACCESS_DENIED: Access denied to football league ${leagueId} standings. Set up your ESPN credentials at /settings/espn.`);
      }

      throw new Error(`ESPN_API_ERROR: ESPN returned error ${response.status}. Please try again.`);
    }

    return await response.json();
  }

  /**
   * Get ESPN credentials from auth-worker
   * Returns null if credentials not found (allows public league access)
   * Throws specific errors for auth failures and other issues
   */
  private async getEspnCredentialsForUser(clerkUserId: string): Promise<EspnCredentials | null> {
    const path = '/credentials/espn?raw=true';
    const requestInit: RequestInit = {
      method: 'GET',
      headers: {
        'X-Clerk-User-ID': clerkUserId,
        'Content-Type': 'application/json',
        ...(this.authHeader ? { 'Authorization': this.authHeader } : {})
      }
    };

    let response: Response;

    // Use service binding if available (preferred), otherwise fall back to URL
    if (this.env.AUTH_WORKER) {
      const url = new URL(path, 'https://auth-worker.internal');
      response = await this.env.AUTH_WORKER.fetch(new Request(url.toString(), requestInit));
    } else {
      // Fallback to AUTH_WORKER_URL for local development
      const isProd = this.env.ENVIRONMENT === 'production' || this.env.NODE_ENV === 'production';
      if (isProd) {
        console.warn('[espn-football] AUTH_WORKER binding missing in prod; using URL fallback');
      }
      const authWorkerUrl = this.env.AUTH_WORKER_URL || 'http://localhost:8786';
      const safePath = path.startsWith('/') ? path : `/${path}`;
      response = await fetch(`${authWorkerUrl}${safePath}`, requestInit);
    }

    const resolvedUserId = response.headers.get('X-User-Id');
    if (resolvedUserId && this.logContext) {
      this.logContext.resolvedUserId = resolvedUserId;
    }

    // 404 = no credentials found - return null to allow public league access
    if (response.status === 404) {
      return null;
    }

    if (response.status === 401) {
      console.error('❌ Auth-worker rejected token');
      throw new Error('ESPN_AUTH_TOKEN_INVALID: Your session has expired. Please refresh the page and try again.');
    }

    if (response.status === 429) {
      const data = await response.json() as { message?: string; resetAt?: string };
      console.error('⚠️ Rate limit exceeded');
      throw new Error(`ESPN_RATE_LIMIT_EXCEEDED: ${data.message || 'Daily limit reached. Please try again later.'}`);
    }

    if (!response.ok) {
      console.error(`❌ Auth-worker error: ${response.status} ${response.statusText}`);
      throw new Error(`ESPN_AUTH_WORKER_ERROR: Unable to retrieve credentials (${response.status}). Please try again.`);
    }

    const data = await response.json() as { success?: boolean; credentials?: EspnCredentials };

    if (!data.success || !data.credentials) {
      console.error('❌ Invalid response from auth-worker:', data);
      throw new Error('ESPN_CREDENTIALS_INVALID: Invalid credentials. Re-enter your ESPN credentials at /settings/espn');
    }

    console.log('✅ Successfully retrieved ESPN credentials');
    return data.credentials;
  }
}
