/**
 * ESPN Types for Frontend
 * 
 * Essential ESPN types extracted from auth-worker for frontend use.
 * These types support the onboarding flow and league management.
 */

// =============================================================================
// CORE SPORT TYPES
// =============================================================================

/**
 * ESPN game ID to sport name mappings
 */
export const ESPN_GAME_IDS = {
  'ffl': 'football',
  'flb': 'baseball', 
  'fba': 'basketball',
  'fhl': 'hockey'
} as const;

export type EspnGameId = keyof typeof ESPN_GAME_IDS;
export type SportName = typeof ESPN_GAME_IDS[EspnGameId];

/**
 * Reverse mapping: sport name to ESPN game ID
 */
export const SPORT_TO_GAME_ID: Record<SportName, EspnGameId> = {
  'football': 'ffl',
  'baseball': 'flb',
  'basketball': 'fba',
  'hockey': 'fhl'
} as const;

// =============================================================================
// LEAGUE TYPES
// =============================================================================

/**
 * Represents a single ESPN fantasy league entry
 */
export interface EspnLeague {
  leagueId: string;
  sport: 'football' | 'hockey' | 'baseball' | 'basketball';
  swid?: string;             // Optional for backward compatibility
  s2?: string;               // Optional for backward compatibility  
  teamId?: string;           // Set after user identifies their team
  teamName?: string;         // Optional: user's team name for display
  leagueName?: string;       // Filled after auto-pull
  seasonYear?: number;       // Filled after auto-pull
}

/**
 * Basic league information returned from ESPN API
 * Used for auto-pull functionality
 */
export interface EspnLeagueInfo {
  leagueId: string;
  leagueName: string;
  sport: SportName;
  seasonYear: number;
  gameId: string;
  standings: EspnStanding[];
  teams: EspnTeam[];
  scoringPeriodId?: number;
  firstScoringPeriod?: number;
  finalScoringPeriod?: number;
  status?: {
    currentMatchupPeriod: number;
    isActive: boolean;
    previousSeasons: number[];
  };
  settings?: {
    name: string;
    size: number;
    status: string;
    season: number;
    currentMatchupPeriod: number;
    gameId: number;
    gameName: string;
    isActive: boolean;
  };
}

/**
 * Team information for league standings and selection
 */
export interface EspnTeam {
  teamId: string;
  teamName: string;
  ownerName?: string;
  wins?: number;
  losses?: number;
  ties?: number;
  rank?: number;
}

/**
 * League standings information
 */
export interface EspnStanding {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  winPercentage: number;
  rank: number;
  playoffSeed?: number;
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

/**
 * Response from auto-pull API
 */
export interface AutoPullResponse {
  success: boolean;
  leagueInfo?: EspnLeagueInfo;
  error?: string;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Type guard for checking if a value is a valid sport
 */
export function isValidSport(sport: string): sport is SportName {
  return Object.values(ESPN_GAME_IDS).includes(sport as SportName);
}

/**
 * Convert ESPN game ID to sport name
 */
export function gameIdToSport(gameId: string): SportName | null {
  if (gameId in ESPN_GAME_IDS) {
    return ESPN_GAME_IDS[gameId as EspnGameId];
  }
  return null;
}

/**
 * Convert sport name to ESPN game ID
 */
export function sportToGameId(sport: string): EspnGameId | null {
  if (isValidSport(sport)) {
    return SPORT_TO_GAME_ID[sport];
  }
  return null;
}