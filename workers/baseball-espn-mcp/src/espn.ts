import type { Env } from './index-hono';
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
      const credentials = await this.getEspnCredentialsForUser();
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

  async fetchRoster(leagueId: string, teamId: string | undefined, year: number = 2025, week?: number, clerkUserId?: string): Promise<EspnTeam> {
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

    const credentials = await this.getEspnCredentialsForUser();
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
        throw new Error(`ESPN_NOT_FOUND: Baseball league ${leagueId} or team ${teamId ?? 'unknown'} not found.`);
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
   * POSITION_SLOTS: Maps position filter names to lineup slot IDs
   * Used for filterSlotIds in ESPN free agent queries
   * These are LINEUP_SLOT_MAP IDs, verified 2026-01-23
   */
  private static readonly POSITION_SLOTS: Record<string, number[]> = {
    'C': [0],           // Catcher slot
    '1B': [1],          // First base slot
    '2B': [2],          // Second base slot
    '3B': [3],          // Third base slot
    'SS': [4],          // Shortstop slot
    'OF': [5],          // General outfield slot
    'MI': [6],          // Middle Infielder (2B/SS)
    'CI': [7],          // Corner Infielder (1B/3B)
    'LF': [8],          // Left field slot
    'CF': [9],          // Center field slot
    'RF': [10],         // Right field slot
    'DH': [11],         // Designated hitter slot
    'UTIL': [12],       // Utility slot
    'P': [13],          // General pitcher slot
    'SP': [14],         // Starting pitcher slot
    'RP': [15],         // Relief pitcher slot
    'IF': [19],         // Infield slot (1B/2B/SS/3B)
    // Compound filters for convenience
    'OUTFIELD': [5, 8, 9, 10],    // All outfield slots (OF, LF, CF, RF)
    'INFIELD': [1, 2, 3, 4, 19],  // All infield slots (1B, 2B, 3B, SS, IF)
    'PITCHER': [13, 14, 15],      // All pitcher slots (P, SP, RP)
    'ALL': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 19]
  };

  async fetchFreeAgents(
    leagueId: string,
    year: number = 2025,
    options: {
      position?: string;  // C, 1B, 2B, 3B, SS, OF, SP, RP, P, ALL
      limit?: number;     // default 25, max 100
    } = {},
    clerkUserId?: string
  ): Promise<any> {
    const { position = 'ALL', limit = 25 } = options;
    const effectiveLimit = Math.min(Math.max(1, limit), 100);

    // Get position slot IDs for filtering
    const slotIds = EspnApiClient.POSITION_SLOTS[position.toUpperCase()] || EspnApiClient.POSITION_SLOTS['ALL'];

    const url = `${this.baseUrl}/games/flb/seasons/${year}/segments/0/leagues/${leagueId}?view=kona_player_info`;

    // Build the X-Fantasy-Filter header for free agents
    const filter = {
      players: {
        filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
        filterSlotIds: { value: slotIds },
        sortPercOwned: { sortPriority: 1, sortAsc: false },
        sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'STANDARD' },
        limit: effectiveLimit
      }
    };

    const headers: Record<string, string> = {
      'User-Agent': 'baseball-espn-mcp/1.0',
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-web-2.0.0',
      'X-Fantasy-Filter': JSON.stringify(filter)
    };

    // Authentication required for free agent data
    if (!clerkUserId || clerkUserId === 'anonymous') {
      throw new Error('ESPN_AUTH_REQUIRED: User authentication required for free agent data. Please sign in and try again.');
    }
    if (!this.authHeader) {
      throw new Error('ESPN_AUTH_REQUIRED: Authorization header missing. Please refresh the page and try again.');
    }

    const credentials = await this.getEspnCredentialsForUser();
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
        throw new Error(`ESPN_NOT_FOUND: Baseball league ${leagueId} not found. Please check the league ID.`);
      }
      if (response.status === 403) {
        throw new Error(`ESPN_ACCESS_DENIED: Access denied to baseball league ${leagueId}. Make sure you're a member of this league.`);
      }

      throw new Error(`ESPN_API_ERROR: ESPN returned error ${response.status}. Please try again.`);
    }

    return await response.json();
  }

  async fetchBoxScores(
    leagueId: string,
    year: number = 2025,
    options: {
      matchupPeriod?: number;
      scoringPeriod?: number;
    } = {},
    clerkUserId?: string
  ): Promise<any> {
    let url = `${this.baseUrl}/games/flb/seasons/${year}/segments/0/leagues/${leagueId}?view=mMatchupScore&view=mScoreboard`;

    if (options.scoringPeriod) {
      url += `&scoringPeriodId=${options.scoringPeriod}`;
    }
    if (options.matchupPeriod) {
      url += `&matchupPeriodId=${options.matchupPeriod}`;
    }

    const headers: Record<string, string> = {
      'User-Agent': 'baseball-espn-mcp/1.0',
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-web-2.0.0'
    };

    // Get user credentials (optional - some box score data may be public)
    if (clerkUserId && clerkUserId !== 'anonymous' && this.authHeader) {
      const credentials = await this.getEspnCredentialsForUser();
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
        throw new Error(`ESPN_NOT_FOUND: Baseball league ${leagueId} not found. Please check the league ID.`);
      }
      if (response.status === 403) {
        throw new Error(`ESPN_ACCESS_DENIED: Access denied to baseball league ${leagueId}. Set up your ESPN credentials at /settings/espn.`);
      }

      throw new Error(`ESPN_API_ERROR: ESPN returned error ${response.status}. Please try again.`);
    }

    return await response.json();
  }

  async fetchRecentActivity(
    leagueId: string,
    year: number = 2025,
    _options: {
      limit?: number;
      type?: 'ALL' | 'WAIVER' | 'TRADE' | 'FA';
    } = {},
    clerkUserId?: string
  ): Promise<any> {
    // Note: ESPN's kona_league_communication view doesn't support limit/type filtering
    // via query params. Filtering would need to be done client-side on the response.
    const url = `${this.baseUrl}/games/flb/seasons/${year}/segments/0/leagues/${leagueId}?view=kona_league_communication`;

    const headers: Record<string, string> = {
      'User-Agent': 'baseball-espn-mcp/1.0',
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-web-2.0.0'
    };

    // Get user credentials (required for activity data)
    if (clerkUserId && clerkUserId !== 'anonymous' && this.authHeader) {
      const credentials = await this.getEspnCredentialsForUser();
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
        throw new Error(`ESPN_NOT_FOUND: Baseball league ${leagueId} not found. Please check the league ID.`);
      }
      if (response.status === 403) {
        throw new Error(`ESPN_ACCESS_DENIED: Access denied to baseball league ${leagueId}. Set up your ESPN credentials at /settings/espn.`);
      }

      throw new Error(`ESPN_API_ERROR: ESPN returned error ${response.status}. Please try again.`);
    }

    return await response.json();
  }

  async fetchStandings(leagueId: string, year: number = 2025, clerkUserId?: string): Promise<any> {
    const url = `${this.baseUrl}/games/flb/seasons/${year}/segments/0/leagues/${leagueId}?view=mStandings&view=mTeam`;

    const headers: Record<string, string> = {
      'User-Agent': 'baseball-espn-mcp/1.0',
      'Accept': 'application/json',
      'X-Fantasy-Source': 'kona',
      'X-Fantasy-Platform': 'kona-web-2.0.0'
    };

    // Get user credentials for standings data (optional - public leagues work without)
    if (clerkUserId && clerkUserId !== 'anonymous' && this.authHeader) {
      const credentials = await this.getEspnCredentialsForUser();
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
        throw new Error(`ESPN_NOT_FOUND: Baseball league ${leagueId} not found. Please check the league ID.`);
      }
      if (response.status === 403) {
        throw new Error(`ESPN_ACCESS_DENIED: Access denied to baseball league ${leagueId} standings. Set up your ESPN credentials at /settings/espn.`);
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
  private async getEspnCredentialsForUser(): Promise<EspnCredentials | null> {
    const path = '/credentials/espn?raw=true';
    const requestInit: RequestInit = {
      method: 'GET',
      headers: {
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
        console.warn('[espn] AUTH_WORKER binding missing in prod; using URL fallback');
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
