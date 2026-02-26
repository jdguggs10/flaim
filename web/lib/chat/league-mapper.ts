/**
 * League data transformation and sport detection utilities for onboarding
 */

export type Sport = 'baseball' | 'football' | 'basketball' | 'hockey';
export type Platform = 'ESPN' | 'Yahoo' | 'Sleeper';

/**
 * ESPN Game ID mappings to sports
 * ESPN uses specific game IDs for each fantasy sport
 */
export const ESPN_GAME_IDS: Record<string, Sport> = {
  'flb': 'baseball',      // Fantasy Baseball
  'ffl': 'football',      // Fantasy Football
  'fba': 'basketball',    // Fantasy Basketball
  'fhl': 'hockey',        // Fantasy Hockey
};

/**
 * Sport display configuration
 */
export const SPORT_CONFIG: Record<Sport, {
  name: string;
  emoji: string;
  color: string;
  mcpTools: string[];
}> = {
  baseball: {
    name: 'Baseball',
    emoji: '⚾',
    color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    mcpTools: ['get_user_session', 'get_league_info', 'get_standings', 'get_matchups', 'get_roster', 'get_free_agents']
  },
  football: {
    name: 'Football',
    emoji: '🏈',
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    mcpTools: ['get_user_session', 'get_league_info', 'get_standings', 'get_matchups', 'get_roster', 'get_free_agents']
  },
  basketball: {
    name: 'Basketball',
    emoji: '🏀',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    mcpTools: ['get_user_session', 'get_league_info', 'get_standings', 'get_matchups', 'get_roster', 'get_free_agents']
  },
  hockey: {
    name: 'Hockey',
    emoji: '🏒',
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    mcpTools: ['get_user_session', 'get_league_info', 'get_standings', 'get_matchups', 'get_roster', 'get_free_agents']
  }
};

/**
 * Automatically detect sport from ESPN gameId
 */
export function detectSportFromGameId(gameId: string): Sport {
  const lowerGameId = gameId.toLowerCase();
  
  // Direct mapping from ESPN game IDs
  for (const [id, sport] of Object.entries(ESPN_GAME_IDS)) {
    if (lowerGameId.includes(id)) {
      return sport;
    }
  }
  
  // Fallback: text-based detection
  if (lowerGameId.includes('baseball') || lowerGameId.includes('mlb')) {
    return 'baseball';
  }
  if (lowerGameId.includes('football') || lowerGameId.includes('nfl')) {
    return 'football';
  }
  if (lowerGameId.includes('basketball') || lowerGameId.includes('nba')) {
    return 'basketball';
  }
  if (lowerGameId.includes('hockey') || lowerGameId.includes('nhl')) {
    return 'hockey';
  }
  
  // Default to football if detection fails
  return 'football';
}

/**
 * Ensure MCP server URL points at the /mcp base (Responses API expects this path)
 */
export function normalizeMcpUrl(url: string): string {
  if (!url) return "";
  // drop trailing slashes
  let normalized = url.replace(/\/+$/, "");
  if (!normalized.endsWith("/mcp")) {
    normalized = `${normalized}/mcp`;
  }
  return normalized;
}

/**
 * Get sport display information
 */
export function getSportConfig(sport: Sport) {
  return SPORT_CONFIG[sport];
}

/**
 * Transform raw league data into normalized format
 */
export function transformLeagueData(rawLeague: any, platform: Platform) {
  const sport = detectSportFromGameId(rawLeague.gameId || '');
  
  return {
    leagueId: rawLeague.id?.toString() || rawLeague.leagueId?.toString(),
    name: rawLeague.name || `League ${rawLeague.id}`,
    sport,
    gameId: rawLeague.gameId || '',
    teams: (rawLeague.teams || []).map((team: any) => ({
      teamId: team.id?.toString() || team.teamId?.toString() || '',
      name: team.name || team.location || `Team ${team.id}`,
      isUserTeam: team.isUserTeam || false
    })),
    isActive: rawLeague.status === 'active' || rawLeague.isActive !== false,
    seasonYear: rawLeague.seasonId || rawLeague.year || new Date().getFullYear(),
    platform
  };
}

/**
 * Group leagues by sport
 */
export function groupLeaguesBySport(leagues: any[]) {
  return leagues.reduce((acc, league) => {
    if (!acc[league.sport]) {
      acc[league.sport] = [];
    }
    acc[league.sport].push(league);
    return acc;
  }, {} as Record<Sport, any[]>);
}

/**
 * Validate league selection for onboarding completion
 */
export function validateLeagueSelection(league: any, team: any): boolean {
  return !!(
    league?.leagueId &&
    league?.sport &&
    league?.platform &&
    team?.teamId &&
    team?.name
  );
}

/**
 * Generate MCP tools configuration based on selected league.
 * Returns the unified gateway config (sport routing is handled by tool parameters).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function generateMcpToolsConfig(_platform: Platform, _sport: Sport) {
  const server = getUnifiedMcpServer();
  if (!server) return null;

  return {
    type: "mcp",
    server_label: server.server_label,
    server_url: server.server_url,
    allowed_tools: server.tools,
    require_approval: "never"
  };
}

/**
 * MCP server info
 */
export interface McpServerInfo {
  server_label: string;
  server_url: string;
  tools: string[];
}

/** Unified tool list (same across all sports — routing is by tool parameters) */
const UNIFIED_TOOLS = [
  'get_user_session',
  'get_ancient_history',
  'get_league_info',
  'get_standings',
  'get_matchups',
  'get_roster',
  'get_free_agents',
];

/**
 * Get the unified MCP server configuration.
 * Returns a single server pointing to the unified gateway (handles all sports/platforms).
 * Returns null if no URL is configured.
 */
export function getUnifiedMcpServer(): McpServerInfo | null {
  const url = normalizeMcpUrl(process.env.NEXT_PUBLIC_FANTASY_MCP_URL || '');
  if (!url) return null;
  return {
    server_label: 'fantasy',
    server_url: url,
    tools: UNIFIED_TOOLS,
  };
}

/**
 * Get unified server as an array (convenience for callers expecting a list).
 * @deprecated Use getUnifiedMcpServer() instead.
 */
export function getAllEspnMcpServers(): McpServerInfo[] {
  const server = getUnifiedMcpServer();
  return server ? [server] : [];
}
