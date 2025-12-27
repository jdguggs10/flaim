import { Env } from './index';
import { EspnLeagueResponse, EspnRosterResponse, EspnTeam } from './types/espn';

// ESPN Credentials interface - local definition for HTTP calls
interface EspnCredentials {
  swid: string;
  s2: string;
  email?: string;
}

export class EspnApiClient {
  private baseUrl = 'https://lm-api-reads.fantasy.espn.com/apis/v3';
  private authHeader?: string | null;
  private logContext?: { resolvedUserId?: string };
  
  constructor(private env: Env, opts?: { authHeader?: string | null; logContext?: { resolvedUserId?: string } }) {
    this.authHeader = opts?.authHeader;
    this.logContext = opts?.logContext;
  }

  async fetchLeague(leagueId: string, year: number = 2025, view: string = 'mSettings', clerkUserId?: string): Promise<EspnLeagueResponse> {
    const url = `${this.baseUrl}/games/flb/seasons/${year}/segments/0/leagues/${leagueId}?view=${view}`;

    const headers: Record<string, string> = {
      'User-Agent': 'baseball-espn-mcp/1.0',
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
      // Handle ESPN-specific error codes
      if (response.status === 401) {
        throw new Error('ESPN_COOKIES_EXPIRED: Your ESPN cookies may have expired. Update them at /settings/espn');
      }
      if (response.status === 429) {
        throw new Error('ESPN_RATE_LIMIT: ESPN rate limit exceeded. Please wait a moment and try again.');
      }
      if (response.status === 404) {
        throw new Error(`ESPN_NOT_FOUND: Baseball league ${leagueId} not found. Please check the league ID.`);
      }
      if (response.status === 403) {
        throw new Error(`ESPN_ACCESS_DENIED: Access denied to baseball league ${leagueId}. This league may be private. Set up your ESPN credentials at /settings/espn`);
      }

      throw new Error(`ESPN_API_ERROR: ESPN returned error ${response.status}. Please try again.`);
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

    // Authentication required for roster data
    if (!clerkUserId || clerkUserId === 'anonymous') {
      throw new Error('ESPN_AUTH_REQUIRED: User authentication required for roster data. Please sign in and try again.');
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
        throw new Error(`ESPN_NOT_FOUND: Baseball league ${leagueId} or team ${teamId} not found.`);
      }
      if (response.status === 403) {
        throw new Error(`ESPN_ACCESS_DENIED: Access denied to baseball league ${leagueId}. Make sure you're a member of this league.`);
      }

      throw new Error(`ESPN_API_ERROR: ESPN returned error ${response.status}. Please try again.`);
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
   * Get ESPN credentials from auth-worker
   * Returns null if credentials not found (allows public league access)
   * Throws specific errors for auth failures and other issues
   */
  private async getEspnCredentialsForUser(clerkUserId: string): Promise<EspnCredentials | null> {
    // Validate AUTH_WORKER_URL in production
    const isProd = this.env.ENVIRONMENT === 'production' || this.env.NODE_ENV === 'production';
    if (!this.env.AUTH_WORKER_URL && isProd) {
      throw new Error('ESPN_CONFIG_ERROR: AUTH_WORKER_URL not configured. Please contact support.');
    }

    const authWorkerUrl = this.env.AUTH_WORKER_URL || 'http://localhost:8786';
    const url = `${authWorkerUrl}/credentials/espn?raw=true`;

    console.log(`🔑 Fetching ESPN credentials for user ${clerkUserId}`);
    console.log(`🔑 Auth header present: ${!!this.authHeader}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Clerk-User-ID': clerkUserId,
        'Content-Type': 'application/json',
        ...(this.authHeader ? { 'Authorization': this.authHeader } : {})
      }
    });

    console.log(`📡 Auth-worker response: ${response.status} ${response.statusText}`);
    const resolvedUserId = response.headers.get('X-User-Id');
    if (resolvedUserId && this.logContext) {
      this.logContext.resolvedUserId = resolvedUserId;
    }

    // 404 = no credentials found - return null to allow public league access
    if (response.status === 404) {
      console.log('ℹ️ No ESPN credentials found for user - proceeding without auth');
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
