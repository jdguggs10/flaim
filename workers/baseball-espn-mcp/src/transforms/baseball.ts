/**
 * Baseball data transforms for ESPN API responses
 * Maps ESPN's numeric IDs to human-readable names
 */

// Position slot IDs to position names
// Position slot IDs to position names (based on ESPN lineup slots observed in 2025 leagues)
export const POSITION_MAP: Record<number, string> = {
  0: 'C',      // Catcher
  1: '1B',     // First Base
  2: '2B',     // Second Base
  3: '3B',     // Third Base
  4: 'SS',     // Shortstop
  5: 'OF',     // Outfield
  12: 'UTIL',  // Utility
  13: 'P',     // Pitcher (general)
  14: 'SP',    // Starting Pitcher
  15: 'RP',    // Relief Pitcher
  16: 'BE',    // Bench
  17: 'IL',    // Injured List
};

// Lineup slot IDs to slot names (slightly different from position)
// Lineup slot IDs to slot names (matching ESPN UI)
export const LINEUP_SLOT_MAP: Record<number, string> = {
  0: 'C',
  1: '1B',
  2: '2B',
  3: '3B',
  4: 'SS',
  5: 'OF',
  12: 'UTIL',
  13: 'P',
  14: 'SP',
  15: 'RP',
  16: 'Bench',
  17: 'IL',
};

const UNKNOWN_POSITION_IDS = new Set<number>();
const UNKNOWN_LINEUP_SLOT_IDS = new Set<number>();

// Batting stat IDs to stat names (IDs 0-31 in ESPN's system)
export const BATTING_STATS_MAP: Record<number, string> = {
  0: 'AB',    // At Bats
  1: 'H',     // Hits
  2: 'AVG',   // Batting Average
  3: 'HR',    // Home Runs
  4: 'R',     // Runs
  5: 'RBI',   // Runs Batted In
  6: 'SB',    // Stolen Bases
  7: '2B',    // Doubles
  8: '3B',    // Triples
  9: 'BB',    // Walks
  10: 'SO',   // Strikeouts (batting)
  11: 'CS',   // Caught Stealing
  12: 'HBP',  // Hit By Pitch
  13: 'SF',   // Sacrifice Flies
  14: 'IBB',  // Intentional Walks
  15: 'GDP',  // Ground Into Double Play
  16: 'PA',   // Plate Appearances
  17: 'TB',   // Total Bases
  18: 'XBH',  // Extra Base Hits
  19: '1B',   // Singles
  20: 'OBP',  // On-Base Percentage
  21: 'SLG',  // Slugging Percentage
  22: 'OPS',  // On-Base + Slugging
  23: 'RC',   // Runs Created
  24: 'SB%',  // Stolen Base Percentage
  25: 'AB/HR', // At Bats per Home Run
  26: 'BB/K', // Walk to Strikeout Ratio
  27: 'G',    // Games (batting)
  28: 'GS',   // Games Started (batting)
  29: 'GIDP', // Grounded Into Double Play
  30: 'E',    // Errors
  31: 'A',    // Assists
};

// Pitching stat IDs to stat names (IDs 32-77 in ESPN's system)
export const PITCHING_STATS_MAP: Record<number, string> = {
  32: 'IP',   // Innings Pitched
  33: 'W',    // Wins
  34: 'L',    // Losses
  35: 'SV',   // Saves
  36: 'K',    // Strikeouts (pitching)
  37: 'ERA',  // Earned Run Average
  38: 'WHIP', // Walks + Hits per IP
  39: 'H',    // Hits Allowed
  40: 'BB',   // Walks Allowed
  41: 'QS',   // Quality Starts
  42: 'ER',   // Earned Runs
  43: 'R',    // Runs Allowed
  44: 'HR',   // Home Runs Allowed
  45: 'HLD',  // Holds
  46: 'BS',   // Blown Saves
  47: 'K/9',  // Strikeouts per 9 Innings
  48: 'BB/9', // Walks per 9 Innings
  49: 'K/BB', // Strikeout to Walk Ratio
  50: 'SV%',  // Save Percentage
  51: 'GS',   // Games Started (pitching)
  52: 'G',    // Games (pitching)
  53: 'CG',   // Complete Games
  54: 'SHO',  // Shutouts
  55: 'WP',   // Wild Pitches
  56: 'BK',   // Balks
  57: 'HBP',  // Hit Batters
  58: 'IBB',  // Intentional Walks Allowed
  59: 'GF',   // Games Finished
  60: 'SVO',  // Save Opportunities
  61: 'BF',   // Batters Faced
  62: 'W%',   // Win Percentage
  63: 'H/9',  // Hits per 9 Innings
  64: 'HR/9', // Home Runs per 9 Innings
  65: 'OBA',  // Opponent Batting Average
  66: 'GO/AO', // Ground Outs to Air Outs
  67: 'OBPA', // Opponent On-Base Percentage
  68: 'SLGA', // Opponent Slugging
  69: 'OPSA', // Opponent OPS
  70: 'GS-W', // Games Started that resulted in Win
  71: 'GS-L', // Games Started that resulted in Loss
  72: 'APP',  // Appearances
  73: 'NSV',  // Net Saves
  74: 'NSB',  // Net Stolen Bases Against
  75: 'PCT',  // Percentage
  76: 'TBF',  // Total Batters Faced
  77: 'PO',   // Pickoffs
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
export const PRO_TEAM_MAP: Record<number, string> = {
  1: 'ATL',   // Atlanta Braves
  2: 'BAL',   // Baltimore Orioles
  3: 'BOS',   // Boston Red Sox
  4: 'CHC',   // Chicago Cubs
  5: 'CWS',   // Chicago White Sox
  6: 'CIN',   // Cincinnati Reds
  7: 'CLE',   // Cleveland Guardians
  8: 'COL',   // Colorado Rockies
  9: 'DET',   // Detroit Tigers
  10: 'HOU',  // Houston Astros
  11: 'KC',   // Kansas City Royals
  12: 'LAA',  // Los Angeles Angels
  13: 'LAD',  // Los Angeles Dodgers
  14: 'MIA',  // Miami Marlins
  15: 'MIL',  // Milwaukee Brewers
  16: 'MIN',  // Minnesota Twins
  17: 'NYM',  // New York Mets
  18: 'NYY',  // New York Yankees
  19: 'OAK',  // Oakland Athletics
  20: 'PHI',  // Philadelphia Phillies
  21: 'PIT',  // Pittsburgh Pirates
  22: 'SD',   // San Diego Padres
  23: 'SF',   // San Francisco Giants
  24: 'SEA',  // Seattle Mariners
  25: 'STL',  // St. Louis Cardinals
  26: 'TB',   // Tampa Bay Rays
  27: 'TEX',  // Texas Rangers
  28: 'TOR',  // Toronto Blue Jays
  29: 'WSH',  // Washington Nationals
  30: 'ARI',  // Arizona Diamondbacks
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
 * Get position name from ESPN position ID
 */
export function getPositionName(positionId: number): string {
  const name = POSITION_MAP[positionId];
  if (name) return name;
  if (!UNKNOWN_POSITION_IDS.has(positionId)) {
    UNKNOWN_POSITION_IDS.add(positionId);
    console.warn(`[baseball-transforms] Unknown position ID: ${positionId}`);
  }
  return `POS_${positionId}`;
}

/**
 * Get stat name from ESPN stat ID
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
 * Transform ESPN player eligible positions array to readable names
 */
export function transformEligiblePositions(positionIds: number[]): string[] {
  return positionIds.map(id => getPositionName(id));
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
    position: getPositionName(player.defaultPositionId || 0),
    eligiblePositions: transformEligiblePositions(player.eligibleSlots || []),
    proTeam: getProTeamAbbrev(player.proTeamId || 0),
    injuryStatus: player.injuryStatus ? INJURY_STATUS_MAP[player.injuryStatus] || player.injuryStatus : undefined,
    percentOwned: player.ownership?.percentOwned,
    percentStarted: player.ownership?.percentStarted,
  };
}
