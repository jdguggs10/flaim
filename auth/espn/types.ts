/**
 * ESPN Fantasy Sports Type Definitions
 * 
 * Consolidated types for ESPN integration, replacing Gambit-specific types
 * with a more flexible multi-league architecture.
 * 
 * @version 2.0 - Multi-league support with manual entry
 */

// =============================================================================
// CORE LEAGUE TYPES
// =============================================================================

/**
 * Represents a single ESPN fantasy league with user credentials
 * Used for the new manual entry + auto-pull flow
 */
export interface EspnLeague {
  leagueId: string;
  sport: 'football' | 'hockey' | 'baseball' | 'basketball';
  swid: string;
  s2: string;
  teamId?: string;           // Set after user identifies their team
  leagueName?: string;       // Filled after auto-pull
  seasonYear?: number;       // Filled after auto-pull
}

/**
 * Container for all ESPN leagues associated with a user
 * Enforces 10-league maximum limit
 */
export interface EspnUserData {
  espnLeagues: EspnLeague[];
  maxLeagues: 10;
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
// LEGACY COMPATIBILITY TYPES (from Gambit)
// =============================================================================

/**
 * @deprecated Use EspnLeagueInfo instead
 * Preserved for backward compatibility during migration
 */
export interface GambitLeague {
  gameId: string;        // "ffl", "flb", "fba", etc.
  leagueId: string;      // numeric string
  leagueName: string;
  seasonId: number;
  teamId: number;
  teamName: string;
}

/**
 * @deprecated Gambit dashboard response - no longer used
 * Preserved for compatibility during migration
 */
export interface GambitDashboardResponse {
  fantasyDashboard?: {
    leagues?: unknown[];
    [key: string]: any;
  };
  configs?: unknown[];  // New 2025 format
  [key: string]: any;
}

/**
 * Standard result wrapper for league discovery operations
 */
export interface LeagueDiscoveryResult {
  success: boolean;
  leagues: GambitLeague[] | EspnLeagueInfo[];
  error?: string;
}

// =============================================================================
// SPORT AND GAME ID MAPPINGS
// =============================================================================

/**
 * ESPN game ID to sport name mappings
 * Updated to include hockey as 'fhl' (was 'fho' in Gambit)
 */
export const ESPN_GAME_IDS = {
  'ffl': 'football',
  'flb': 'baseball', 
  'fba': 'basketball',
  'fhl': 'hockey'     // Updated from 'fho' to match current ESPN API
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
// CREDENTIAL AND AUTHENTICATION TYPES
// =============================================================================

/**
 * ESPN authentication credentials (core fields only)
 */
export interface EspnCredentials {
  swid: string;
  s2: string;   // Note: property name matches ESPN cookie name
}

/**
 * ESPN credentials with storage metadata (used by storage layer)
 */
export interface EspnCredentialsWithMetadata extends EspnCredentials {
  clerkUserId?: string;
  email?: string;
  created_at?: string;
  updated_at?: string;
  // Alias for compatibility
  espn_s2?: string;
}

/**
 * Validation result for ESPN credentials
 */
export interface CredentialValidationResult {
  valid: boolean;
  error?: string;
  leagues?: EspnLeagueInfo[];
}

// =============================================================================
// API REQUEST/RESPONSE TYPES
// =============================================================================

/**
 * Request body for adding a new league
 */
export interface AddLeagueRequest {
  leagueId: string;
  sport: SportName;
  swid: string;
  s2: string;
}

/**
 * Request body for auto-pull league information
 */
export interface AutoPullRequest {
  leagueId: string;
  sport: SportName;
  swid: string;
  s2: string;
}

/**
 * Response from auto-pull API
 */
export interface AutoPullResponse {
  success: boolean;
  leagueInfo?: EspnLeagueInfo;
  error?: string;
}

/**
 * Request to save selected team for a league
 */
export interface SaveTeamRequest {
  leagueId: string;
  teamId: string;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * ESPN League Discovery Error Definitions
 * Consolidated from gambit/errors.ts
 */
export class AutomaticLeagueDiscoveryFailed extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'AutomaticLeagueDiscoveryFailed';
  }
}

export class EspnCredentialsRequired extends Error {
  constructor(message: string = 'ESPN credentials required for league discovery') {
    super(message);
    this.name = 'EspnCredentialsRequired';
  }
}

export class EspnAuthenticationFailed extends Error {
  constructor(message: string = 'ESPN authentication failed - invalid credentials') {
    super(message);
    this.name = 'EspnAuthenticationFailed';
  }
}

export class MaxLeaguesExceeded extends Error {
  constructor(maxLeagues: number = 10) {
    super(`Maximum of ${maxLeagues} leagues allowed per user`);
    this.name = 'MaxLeaguesExceeded';
  }
}

export class DuplicateLeagueError extends Error {
  constructor(leagueId: string, sport: SportName) {
    super(`League ${leagueId} for ${sport} already exists`);
    this.name = 'DuplicateLeagueError';
  }
}

export class TeamNotFoundError extends Error {
  constructor(teamId: string, leagueId: string) {
    super(`Team ${teamId} not found in league ${leagueId}`);
    this.name = 'TeamNotFoundError';
  }
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Helper type for partial league updates
 */
export type PartialEspnLeague = Partial<Omit<EspnLeague, 'leagueId' | 'sport'>> & {
  leagueId: string;
  sport: SportName;
};

/**
 * Type guard for checking if a value is a valid sport
 */
export function isValidSport(sport: string): sport is SportName {
  return Object.values(ESPN_GAME_IDS).includes(sport as SportName);
}

/**
 * Type guard for checking if a value is a valid ESPN game ID
 */
export function isValidGameId(gameId: string): gameId is EspnGameId {
  return Object.keys(ESPN_GAME_IDS).includes(gameId as EspnGameId);
}

/**
 * Convert ESPN game ID to sport name
 */
export function gameIdToSport(gameId: string): SportName | null {
  if (isValidGameId(gameId)) {
    return ESPN_GAME_IDS[gameId];
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

/**
 * Validate ESPN credentials format
 */
export function validateEspnCredentials(credentials: Partial<EspnCredentials>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // SWID should match UUID format in curly braces: {xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}
  const SWID_REGEX = /^\{[0-9A-Fa-f\-]{36}\}$/;
  
  if (!credentials.swid) {
    errors.push('SWID is required');
  } else if (!SWID_REGEX.test(credentials.swid)) {
    errors.push('SWID must be a valid UUID format: {xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}');
  }
  
  if (!credentials.s2) {
    errors.push('ESPN_S2 cookie is required');
  } else if (credentials.s2.length < 50) {
    errors.push('ESPN_S2 appears to be too short - please copy the entire cookie value');
  }
  // Note: Removed upper limit check - ESPN_S2 can be longer than 80 characters
  
  return {
    valid: errors.length === 0,
    errors
  };
}