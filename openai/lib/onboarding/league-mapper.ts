/**
 * League data transformation and sport detection utilities for onboarding
 */

export type Sport = 'baseball' | 'football' | 'basketball' | 'hockey';
export type Platform = 'ESPN' | 'Yahoo';

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
    mcpTools: ['get_espn_league_info', 'get_espn_team_roster', 'get_espn_matchups']
  },
  football: {
    name: 'Football',
    emoji: '🏈',
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    mcpTools: ['get_espn_football_league_info', 'get_espn_football_team', 'get_espn_football_matchups']
  },
  basketball: {
    name: 'Basketball',
    emoji: '🏀',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    mcpTools: ['get_espn_basketball_league_info', 'get_espn_basketball_team', 'get_espn_basketball_matchups']
  },
  hockey: {
    name: 'Hockey',
    emoji: '🏒',
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    mcpTools: ['get_espn_hockey_league_info', 'get_espn_hockey_team', 'get_espn_hockey_matchups']
  }
};

/**
 * Platform-specific MCP server configurations
 */
export const MCP_SERVER_CONFIG: Record<Platform, Record<Sport, {
  serverUrl: string;
  tools: string[];
}>> = {
  ESPN: {
    baseball: {
      serverUrl: process.env.NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL || process.env.BASEBALL_ESPN_MCP_URL || '',
      tools: SPORT_CONFIG.baseball.mcpTools
    },
    football: {
      serverUrl: process.env.NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL || process.env.FOOTBALL_ESPN_MCP_URL || '',
      tools: SPORT_CONFIG.football.mcpTools
    },
    basketball: {
      serverUrl: process.env.NEXT_PUBLIC_BASKETBALL_ESPN_MCP_URL || process.env.BASKETBALL_ESPN_MCP_URL || '',
      tools: SPORT_CONFIG.basketball.mcpTools
    },
    hockey: {
      serverUrl: process.env.NEXT_PUBLIC_HOCKEY_ESPN_MCP_URL || process.env.HOCKEY_ESPN_MCP_URL || '',
      tools: SPORT_CONFIG.hockey.mcpTools
    }
  },
  Yahoo: {
    baseball: {
      serverUrl: process.env.BASEBALL_YAHOO_MCP_URL || 'https://baseball-yahoo-mcp.workers.dev',
      tools: ['get_yahoo_league_info', 'get_yahoo_team_roster', 'get_yahoo_matchups']
    },
    football: {
      serverUrl: process.env.FOOTBALL_YAHOO_MCP_URL || 'https://football-yahoo-mcp.workers.dev',
      tools: ['get_yahoo_football_league_info', 'get_yahoo_football_team', 'get_yahoo_football_matchups']
    },
    basketball: {
      serverUrl: process.env.BASKETBALL_YAHOO_MCP_URL || 'https://basketball-yahoo-mcp.workers.dev',
      tools: ['get_yahoo_basketball_league_info', 'get_yahoo_basketball_team', 'get_yahoo_basketball_matchups']
    },
    hockey: {
      serverUrl: process.env.HOCKEY_YAHOO_MCP_URL || 'https://hockey-yahoo-mcp.workers.dev',
      tools: ['get_yahoo_hockey_league_info', 'get_yahoo_hockey_team', 'get_yahoo_hockey_matchups']
    }
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
 * Get MCP configuration for a platform and sport
 */
export function getMcpConfig(platform: Platform, sport: Sport) {
  return MCP_SERVER_CONFIG[platform]?.[sport] || null;
}

/**
 * Ensure MCP server URL points at the /mcp base (Responses API expects this path)
 */
function normalizeMcpUrl(url: string): string {
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
 * Generate MCP tools configuration based on selected league
 */
export function generateMcpToolsConfig(platform: Platform, sport: Sport) {
  const mcpConfig = getMcpConfig(platform, sport);
  
  if (!mcpConfig) {
    return null;
  }
  
  return {
    type: "mcp",
    server_label: `fantasy-${sport}`,
    server_url: normalizeMcpUrl(mcpConfig.serverUrl),
    allowed_tools: mcpConfig.tools,
    require_approval: "never"
  };
}