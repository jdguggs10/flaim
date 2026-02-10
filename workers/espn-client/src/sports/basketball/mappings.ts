// workers/espn-client/src/sports/basketball/mappings.ts

/**
 * Basketball data transforms for ESPN API responses
 * Maps ESPN's numeric IDs to human-readable names
 *
 * Source: cwendt94/espn-api constant.py (basketball)
 * Verified: NOT YET -- no live league credentials available
 */

// =============================================================================
// SINGLE ID SPACE -- Basketball uses the same IDs for both defaultPositionId
// and lineupSlotId/eligibleSlots (unlike baseball which has two separate spaces).
// =============================================================================

// Position IDs to position names
// Used for both defaultPositionId and lineupSlotId/eligibleSlots
export const POSITION_MAP: Record<number, string> = {
  0: 'PG',     // Point Guard
  1: 'SG',     // Shooting Guard
  2: 'SF',     // Small Forward
  3: 'PF',     // Power Forward
  4: 'C',      // Center
  5: 'G',      // Guard (PG/SG flex)
  6: 'F',      // Forward (SF/PF flex)
  7: 'SG/SF',  // Swing (SG/SF)
  8: 'G/F',    // Guard/Forward
  9: 'PF/C',   // Power Forward/Center
  10: 'F/C',   // Forward/Center
  11: 'UTIL',  // Utility (any position)
  12: 'Bench', // Bench
  13: 'IR',    // Injured Reserve
};

// Alias for consistency with football/baseball handler imports
export const LINEUP_SLOT_MAP = POSITION_MAP;

// Pro team IDs to team abbreviations (NBA teams)
// Source: cwendt94/espn-api constant.py
export const PRO_TEAM_MAP: Record<number, string> = {
  0: 'FA',    // Free Agent
  1: 'ATL',   // Atlanta Hawks
  2: 'BOS',   // Boston Celtics
  3: 'NOP',   // New Orleans Pelicans
  4: 'CHI',   // Chicago Bulls
  5: 'CLE',   // Cleveland Cavaliers
  6: 'DAL',   // Dallas Mavericks
  7: 'DEN',   // Denver Nuggets
  8: 'DET',   // Detroit Pistons
  9: 'GSW',   // Golden State Warriors
  10: 'HOU',  // Houston Rockets
  11: 'IND',  // Indiana Pacers
  12: 'LAC',  // Los Angeles Clippers
  13: 'LAL',  // Los Angeles Lakers
  14: 'MIA',  // Miami Heat
  15: 'MIL',  // Milwaukee Bucks
  16: 'MIN',  // Minnesota Timberwolves
  17: 'BKN',  // Brooklyn Nets
  18: 'NYK',  // New York Knicks
  19: 'ORL',  // Orlando Magic
  20: 'PHI',  // Philadelphia 76ers
  21: 'PHX',  // Phoenix Suns
  22: 'POR',  // Portland Trail Blazers
  23: 'SAC',  // Sacramento Kings
  24: 'SAS',  // San Antonio Spurs
  25: 'OKC',  // Oklahoma City Thunder
  26: 'UTA',  // Utah Jazz
  27: 'WAS',  // Washington Wizards
  28: 'TOR',  // Toronto Raptors
  29: 'MEM',  // Memphis Grizzlies
  30: 'CHA',  // Charlotte Hornets
};

// Injury status codes (same across all ESPN sports)
export const INJURY_STATUS_MAP: Record<string, string> = {
  ACTIVE: 'Active',
  OUT: 'Out',
  DAY_TO_DAY: 'Day-to-Day',
  QUESTIONABLE: 'Questionable',
  DOUBTFUL: 'Doubtful',
  INJURY_RESERVE: 'IR',
  SUSPENSION: 'Suspended',
};

// POSITION_SLOTS: Maps position filter names to lineup slot IDs
// Used for filterSlotIds in ESPN free agent queries
export const POSITION_SLOTS: Record<string, number[]> = {
  'PG': [0],
  'SG': [1],
  'SF': [2],
  'PF': [3],
  'C': [4],
  'G': [5],
  'F': [6],
  'UTIL': [11],
  'ALL': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

// STATS_MAP: ESPN stat IDs to readable stat names
// Source: cwendt94/espn-api constant.py (basketball)
// UNVERIFIED -- no live league credentials
export const STATS_MAP: Record<number, string> = {
  0: 'PTS',     // Points
  1: 'BLK',     // Blocks
  2: 'STL',     // Steals
  3: 'AST',     // Assists
  4: 'OREB',    // Offensive Rebounds
  5: 'DREB',    // Defensive Rebounds
  6: 'REB',     // Total Rebounds
  7: 'EJ',      // Ejections
  8: 'FF',      // Flagrant Fouls
  9: 'PF',      // Personal Fouls
  10: 'TF',     // Technical Fouls
  11: 'TO',     // Turnovers
  12: 'DQ',     // Disqualifications
  13: 'FGM',    // Field Goals Made
  14: 'FGA',    // Field Goals Attempted
  15: 'FTM',    // Free Throws Made
  16: 'FTA',    // Free Throws Attempted
  17: '3PM',    // Three Pointers Made
  18: '3PA',    // Three Pointers Attempted
  19: 'FG%',    // Field Goal Percentage
  20: 'FT%',    // Free Throw Percentage
  21: '3PT%',   // Three Point Percentage
  22: 'AFG%',   // Adjusted FG%
  23: 'FGMI',   // Field Goals Missed
  24: 'FTMI',   // Free Throws Missed
  25: '3PMI',   // Three Pointers Missed
  26: 'APG',    // Assists Per Game
  27: 'BPG',    // Blocks Per Game
  28: 'MPG',    // Minutes Per Game
  29: 'PPG',    // Points Per Game
  30: 'RPG',    // Rebounds Per Game
  31: 'SPG',    // Steals Per Game
  32: 'TOPG',   // Turnovers Per Game
  33: '3PG',    // Three Pointers Per Game
  34: 'PPM',    // Points Per Minute
  35: 'A/TO',   // Assist to Turnover Ratio
  36: 'STR',    // Starter
  37: 'DD',     // Double-Doubles
  38: 'TD',     // Triple-Doubles
  39: 'QD',     // Quadruple-Doubles
  40: 'MIN',    // Minutes Played
  41: 'GS',     // Games Started
  42: 'GP',     // Games Played
  43: 'TW',     // Team Wins
  44: 'FTR',    // Free Throw Rate
};

// Track unknown IDs for logging
const UNKNOWN_POSITION_IDS = new Set<number>();
const UNKNOWN_LINEUP_SLOT_IDS = new Set<number>();

export function getPositionName(positionId: number): string {
  const name = POSITION_MAP[positionId];
  if (name) return name;
  if (!UNKNOWN_POSITION_IDS.has(positionId)) {
    UNKNOWN_POSITION_IDS.add(positionId);
    console.warn(`[basketball-mappings] Unknown position ID: ${positionId}`);
  }
  return `POS_${positionId}`;
}

export function getLineupSlotName(slotId: number): string {
  const name = LINEUP_SLOT_MAP[slotId];
  if (name) return name;
  if (!UNKNOWN_LINEUP_SLOT_IDS.has(slotId)) {
    UNKNOWN_LINEUP_SLOT_IDS.add(slotId);
    console.warn(`[basketball-mappings] Unknown lineup slot ID: ${slotId}`);
  }
  return `SLOT_${slotId}`;
}

export function getProTeamAbbrev(teamId: number): string {
  return PRO_TEAM_MAP[teamId] || 'FA';
}

export function getInjuryStatus(status: string): string {
  return INJURY_STATUS_MAP[status] || status;
}

export function transformEligiblePositions(slots: number[]): string[] {
  return slots
    .map(slot => POSITION_MAP[slot])
    .filter((name): name is string => !!name && !['Bench', 'IR'].includes(name));
}

export function getStatName(statId: number): string {
  return STATS_MAP[statId] || `STAT_${statId}`;
}

export function transformStats(stats: Record<string, number>): Record<string, number> {
  const transformed: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats)) {
    const statId = parseInt(key, 10);
    const statName = getStatName(statId);
    transformed[statName] = value;
  }
  return transformed;
}
