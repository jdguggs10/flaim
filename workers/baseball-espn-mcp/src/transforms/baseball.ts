/**
 * Baseball data transforms for ESPN API responses
 * Maps ESPN's numeric IDs to human-readable names
 */

// =============================================================================
// TWO DIFFERENT ID SPACES - DO NOT CONFUSE THESE
// =============================================================================
// ESPN uses different IDs for:
// 1. defaultPositionId - A player's natural position (e.g., 6 = SS for shortstop)
// 2. lineupSlotId/eligibleSlots - Roster slots where a player can be placed (e.g., 6 = MI)
// See BASEBALL_MAPPING_INVESTIGATION.md for full documentation.
// =============================================================================

// DEFAULT_POSITION_MAP: Maps defaultPositionId field (player's natural position)
// Verified via league 30201 player data (2026-01-23)
export const DEFAULT_POSITION_MAP: Record<number, string> = {
  1: 'SP',   // Starting Pitcher
  2: 'C',    // Catcher
  3: '1B',   // First Base
  4: '2B',   // Second Base
  5: '3B',   // Third Base
  6: 'SS',   // Shortstop
  7: 'LF',   // Left Field
  8: 'CF',   // Center Field
  9: 'RF',   // Right Field
  10: 'DH',  // Designated Hitter
  11: 'RP',  // Relief Pitcher
};

// LINEUP_SLOT_MAP: Maps lineupSlotId and eligibleSlots fields (roster slots)
// Verified via league 30201 roster data (2026-01-23)
export const LINEUP_SLOT_MAP: Record<number, string> = {
  0: 'C',     // Catcher slot
  1: '1B',    // First base slot
  2: '2B',    // Second base slot
  3: '3B',    // Third base slot
  4: 'SS',    // Shortstop slot
  5: 'OF',    // Outfield slot (general)
  6: 'MI',    // Middle Infielder (2B/SS eligible)
  7: 'CI',    // Corner Infielder (1B/3B eligible)
  8: 'LF',    // Left field slot
  9: 'CF',    // Center field slot
  10: 'RF',   // Right field slot
  11: 'DH',   // Designated hitter slot
  12: 'UTIL', // Utility slot (any position player)
  13: 'P',    // Pitcher slot (general)
  14: 'SP',   // Starting pitcher slot
  15: 'RP',   // Relief pitcher slot
  16: 'Bench', // Bench
  17: 'IL',   // Injured List
  19: 'IF',   // Infield slot (1B/2B/SS/3B eligible)
  // 18: unknown - appears in lineupSlotCounts only, never observed on players
  // 22: possibly NA/Minors - only seen on minor league pitchers
};

// DEPRECATED: Use DEFAULT_POSITION_MAP or LINEUP_SLOT_MAP instead
// Kept for backwards compatibility - maps to LINEUP_SLOT_MAP
export const POSITION_MAP: Record<number, string> = LINEUP_SLOT_MAP;

const UNKNOWN_DEFAULT_POSITION_IDS = new Set<number>();
const UNKNOWN_LINEUP_SLOT_IDS = new Set<number>();

// Batting stat IDs to stat names
// Verified against cwendt94/espn-api constant.py (2026-01-23)
// Note: B_ prefix indicates batter version of stats that exist for both batters and pitchers
export const BATTING_STATS_MAP: Record<number, string> = {
  0: 'AB',      // At Bats
  1: 'H',       // Hits
  2: 'AVG',     // Batting Average
  3: '2B',      // Doubles
  4: '3B',      // Triples
  5: 'HR',      // Home Runs
  6: 'XBH',     // Extra Base Hits (2B + 3B + HR)
  7: '1B',      // Singles
  8: 'TB',      // Total Bases
  9: 'SLG',     // Slugging Percentage
  10: 'BB',     // Walks (batter)
  11: 'IBB',    // Intentional Walks (batter)
  12: 'HBP',    // Hit By Pitch
  13: 'SF',     // Sacrifice Flies
  14: 'SH',     // Sacrifice Hits (bunts)
  15: 'SAC',    // Total Sacrifices (SF + SH)
  16: 'PA',     // Plate Appearances
  17: 'OBP',    // On-Base Percentage
  18: 'OPS',    // On-Base + Slugging
  19: 'RC',     // Runs Created
  20: 'R',      // Runs
  21: 'RBI',    // Runs Batted In
  // 22: unknown
  23: 'SB',     // Stolen Bases
  24: 'CS',     // Caught Stealing
  25: 'SB-CS',  // Net Stolen Bases
  26: 'GDP',    // Grounded Into Double Play
  27: 'SO',     // Strikeouts (batter)
  28: 'PS',     // Pitches Seen
  29: 'PPA',    // Pitches Per Plate Appearance
  // 30: unknown
  31: 'CYC',    // Cycles
};

// Pitching and fielding stat IDs to stat names
// Verified against cwendt94/espn-api constant.py (2026-01-23)
// Note: P_ prefix indicates pitcher version of stats that exist for both batters and pitchers
export const PITCHING_STATS_MAP: Record<number, string> = {
  32: 'GP',     // Games Pitched
  33: 'GS',     // Games Started
  34: 'OUTS',   // Outs recorded (divide by 3 for IP)
  35: 'TBF',    // Total Batters Faced
  36: 'P',      // Pitches thrown
  37: 'H',      // Hits Allowed
  38: 'OBA',    // Opponent Batting Average
  39: 'BB',     // Walks Allowed
  40: 'IBB',    // Intentional Walks Allowed
  41: 'WHIP',   // Walks + Hits per IP
  42: 'HBP',    // Hit Batters
  43: 'OOBP',   // Opponent On-Base Percentage
  44: 'R',      // Runs Allowed
  45: 'ER',     // Earned Runs
  46: 'HR',     // Home Runs Allowed
  47: 'ERA',    // Earned Run Average
  48: 'K',      // Strikeouts
  49: 'K/9',    // Strikeouts per 9 Innings
  50: 'WP',     // Wild Pitches
  51: 'BLK',    // Balks
  52: 'PK',     // Pickoffs
  53: 'W',      // Wins
  54: 'L',      // Losses
  55: 'WPCT',   // Win Percentage
  56: 'SVO',    // Save Opportunities
  57: 'SV',     // Saves
  58: 'BLSV',   // Blown Saves
  59: 'SV%',    // Save Percentage
  60: 'HLD',    // Holds
  // 61: unknown
  62: 'CG',     // Complete Games
  63: 'QS',     // Quality Starts
  // 64: unknown
  65: 'NH',     // No-Hitters
  66: 'PG',     // Perfect Games
  // Fielding stats
  67: 'TC',     // Total Chances (PO + A + E)
  68: 'PO',     // Put Outs
  69: 'A',      // Assists
  70: 'OFA',    // Outfield Assists
  71: 'FPCT',   // Fielding Percentage
  72: 'E',      // Errors
  73: 'DP',     // Double Plays turned
  // Game results by team outcome
  74: 'B_G_W',  // Batter games where team won
  75: 'B_G_L',  // Batter games where team lost
  76: 'P_G_W',  // Pitcher games where team won
  77: 'P_G_L',  // Pitcher games where team lost
  // Additional stats
  81: 'G',      // Games Played
  82: 'K/BB',   // Strikeout to Walk Ratio
  83: 'SVHD',   // Saves + Holds
  99: 'STARTER', // Starting lineup indicator
};

// Activity message type codes
export const ACTIVITY_TYPE_MAP: Record<number, string> = {
  178: 'FA_ADD',       // Free Agent Add
  180: 'WAIVER_ADD',   // Waiver Add
  179: 'DROP',         // Drop Player
  181: 'TRADE',        // Trade
  239: 'TRADE_ACCEPT', // Trade Accepted
  244: 'TRADE_DECLINE', // Trade Declined
  250: 'TRADE_VETO',   // Trade Vetoed
};

// Pro team IDs to team abbreviations
// Verified via ESPN Fantasy API v3 proTeamSchedules endpoint (2026-01-23)
// See BASEBALL_MAPPING_INVESTIGATION.md for verification details
export const PRO_TEAM_MAP: Record<number, string> = {
  0: 'FA',   // Free Agent
  1: 'BAL',  // Baltimore Orioles
  2: 'BOS',  // Boston Red Sox
  3: 'LAA',  // Los Angeles Angels
  4: 'CHW',  // Chicago White Sox
  5: 'CLE',  // Cleveland Guardians
  6: 'DET',  // Detroit Tigers
  7: 'KC',   // Kansas City Royals
  8: 'MIL',  // Milwaukee Brewers
  9: 'MIN',  // Minnesota Twins
  10: 'NYY', // New York Yankees
  11: 'OAK', // Oakland Athletics
  12: 'SEA', // Seattle Mariners
  13: 'TEX', // Texas Rangers
  14: 'TOR', // Toronto Blue Jays
  15: 'ATL', // Atlanta Braves
  16: 'CHC', // Chicago Cubs
  17: 'CIN', // Cincinnati Reds
  18: 'HOU', // Houston Astros
  19: 'LAD', // Los Angeles Dodgers
  20: 'WSH', // Washington Nationals
  21: 'NYM', // New York Mets
  22: 'PHI', // Philadelphia Phillies
  23: 'PIT', // Pittsburgh Pirates
  24: 'STL', // St. Louis Cardinals
  25: 'SD',  // San Diego Padres
  26: 'SF',  // San Francisco Giants
  27: 'COL', // Colorado Rockies
  28: 'MIA', // Miami Marlins
  29: 'ARI', // Arizona Diamondbacks
  30: 'TB',  // Tampa Bay Rays
};

// Injury status codes
export const INJURY_STATUS_MAP: Record<string, string> = {
  ACTIVE: 'Active',
  OUT: 'Out',
  DAY_TO_DAY: 'Day-to-Day',
  INJURY_RESERVE: 'IL (Injured List)',
  SUSPENSION: 'Suspended',
  PATERNITY: 'Paternity Leave',
  BEREAVEMENT: 'Bereavement',
};

/**
 * Get position name from ESPN defaultPositionId field
 * Use this for the player's NATURAL position (what position they play)
 */
export function getDefaultPositionName(positionId: number): string {
  const name = DEFAULT_POSITION_MAP[positionId];
  if (name) return name;
  if (!UNKNOWN_DEFAULT_POSITION_IDS.has(positionId)) {
    UNKNOWN_DEFAULT_POSITION_IDS.add(positionId);
    console.warn(`[baseball-transforms] Unknown defaultPositionId: ${positionId}`);
  }
  return `POS_${positionId}`;
}

/**
 * @deprecated Use getDefaultPositionName() for defaultPositionId field
 *             or getLineupSlotName() for lineupSlotId/eligibleSlots
 */
export function getPositionName(positionId: number): string {
  // For backwards compat, try DEFAULT_POSITION_MAP first (most common use case)
  // then fall back to LINEUP_SLOT_MAP
  const defaultName = DEFAULT_POSITION_MAP[positionId];
  if (defaultName) return defaultName;
  return getLineupSlotName(positionId);
}

/**
 * Get stat name from ESPN stat ID
 * IDs 0-31: Batting stats (BATTING_STATS_MAP)
 * IDs 32+: Pitching/fielding stats (PITCHING_STATS_MAP)
 */
export function getStatName(statId: number): string {
  if (statId < 32) {
    return BATTING_STATS_MAP[statId] || `STAT_${statId}`;
  }
  return PITCHING_STATS_MAP[statId] || `STAT_${statId}`;
}

/**
 * Get pro team abbreviation from team ID
 */
export function getProTeamAbbrev(teamId: number): string {
  return PRO_TEAM_MAP[teamId] || 'FA'; // FA = Free Agent (no team)
}

/**
 * Get lineup slot name from ESPN lineup slot ID
 */
export function getLineupSlotName(slotId: number): string {
  const name = LINEUP_SLOT_MAP[slotId];
  if (name) return name;
  if (!UNKNOWN_LINEUP_SLOT_IDS.has(slotId)) {
    UNKNOWN_LINEUP_SLOT_IDS.add(slotId);
    console.warn(`[baseball-transforms] Unknown lineup slot ID: ${slotId}`);
  }
  return `SLOT_${slotId}`;
}

/**
 * Transform ESPN player stats object to use readable stat names
 */
export function transformStats(stats: Record<string, number>): Record<string, number> {
  const transformed: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats)) {
    const statId = parseInt(key, 10);
    const statName = getStatName(statId);
    transformed[statName] = value;
  }
  return transformed;
}

/**
 * Transform ESPN player eligibleSlots array to readable slot names
 * Note: eligibleSlots uses LINEUP_SLOT_MAP IDs, not defaultPositionId IDs
 */
export function transformEligiblePositions(slotIds: number[]): string[] {
  return slotIds.map(id => getLineupSlotName(id));
}

/**
 * Basic player info transformation
 */
export interface TransformedPlayer {
  id: number;
  name: string;
  position: string;
  eligiblePositions: string[];
  proTeam: string;
  injuryStatus?: string;
  percentOwned?: number;
  percentStarted?: number;
}

/**
 * Transform ESPN player object to more readable format
 */
export function transformPlayer(player: any): TransformedPlayer {
  return {
    id: player.id,
    name: player.fullName || player.player?.fullName || 'Unknown',
    // Use DEFAULT_POSITION_MAP for defaultPositionId (player's natural position)
    position: getDefaultPositionName(player.defaultPositionId || 0),
    // Use LINEUP_SLOT_MAP for eligibleSlots (roster slots where player can be placed)
    eligiblePositions: transformEligiblePositions(player.eligibleSlots || []),
    proTeam: getProTeamAbbrev(player.proTeamId || 0),
    injuryStatus: player.injuryStatus ? INJURY_STATUS_MAP[player.injuryStatus] || player.injuryStatus : undefined,
    percentOwned: player.ownership?.percentOwned,
    percentStarted: player.ownership?.percentStarted,
  };
}
