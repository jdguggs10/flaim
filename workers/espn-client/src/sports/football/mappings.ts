// workers/espn-client/src/sports/football/mappings.ts

/**
 * Football data transforms for ESPN API responses
 * Maps ESPN's numeric IDs to human-readable names
 */

// Position IDs to position names (ESPN player default positions)
export const POSITION_MAP: Record<number, string> = {
  1: 'QB',     // Quarterback
  2: 'RB',     // Running Back
  3: 'WR',     // Wide Receiver
  4: 'TE',     // Tight End
  5: 'K',      // Kicker
  16: 'D/ST',  // Defense/Special Teams
};

// Lineup slot IDs to slot names (matching ESPN UI)
export const LINEUP_SLOT_MAP: Record<number, string> = {
  0: 'QB',
  2: 'RB',
  4: 'WR',
  6: 'TE',
  17: 'K',
  16: 'D/ST',
  23: 'FLEX',    // RB/WR/TE flex
  20: 'Bench',
  21: 'IR',
};

// Pro team IDs to team abbreviations (NFL teams)
export const PRO_TEAM_MAP: Record<number, string> = {
  0: 'FA',      // Free Agent
  1: 'ATL',     // Atlanta Falcons
  2: 'BUF',     // Buffalo Bills
  3: 'CHI',     // Chicago Bears
  4: 'CIN',     // Cincinnati Bengals
  5: 'CLE',     // Cleveland Browns
  6: 'DAL',     // Dallas Cowboys
  7: 'DEN',     // Denver Broncos
  8: 'DET',     // Detroit Lions
  9: 'GB',      // Green Bay Packers
  10: 'TEN',    // Tennessee Titans
  11: 'IND',    // Indianapolis Colts
  12: 'KC',     // Kansas City Chiefs
  13: 'LV',     // Las Vegas Raiders
  14: 'LAR',    // Los Angeles Rams
  15: 'MIA',    // Miami Dolphins
  16: 'MIN',    // Minnesota Vikings
  17: 'NE',     // New England Patriots
  18: 'NO',     // New Orleans Saints
  19: 'NYG',    // New York Giants
  20: 'NYJ',    // New York Jets
  21: 'PHI',    // Philadelphia Eagles
  22: 'ARI',    // Arizona Cardinals
  23: 'PIT',    // Pittsburgh Steelers
  24: 'LAC',    // Los Angeles Chargers
  25: 'SF',     // San Francisco 49ers
  26: 'SEA',    // Seattle Seahawks
  27: 'TB',     // Tampa Bay Buccaneers
  28: 'WSH',    // Washington Commanders
  29: 'CAR',    // Carolina Panthers
  30: 'JAX',    // Jacksonville Jaguars
  33: 'BAL',    // Baltimore Ravens
  34: 'HOU',    // Houston Texans
};

// Injury status codes
export const INJURY_STATUS_MAP: Record<string, string> = {
  ACTIVE: 'Active',
  OUT: 'Out',
  QUESTIONABLE: 'Questionable',
  DOUBTFUL: 'Doubtful',
  INJURY_RESERVE: 'IR',
  SUSPENSION: 'Suspended',
  PROBABLE: 'Probable',
  DAY_TO_DAY: 'Day-to-Day',
};

// POSITION_SLOTS: Maps position filter names to lineup slot IDs
// Used for filterSlotIds in ESPN free agent queries
// These are LINEUP_SLOT_MAP IDs (verified via espn-api library)
export const POSITION_SLOTS: Record<string, number[]> = {
  'QB': [0],        // Quarterback slot
  'RB': [2],        // Running back slot
  'WR': [4],        // Wide receiver slot
  'TE': [6],        // Tight end slot
  'K': [17],        // Kicker slot
  'D/ST': [16],     // Defense/Special Teams slot
  'DST': [16],      // Alternate spelling for D/ST
  'FLEX': [23],     // RB/WR/TE flex slot
  'ALL': [0, 2, 4, 6, 16, 17, 23]  // All active position slots
};

// Track unknown IDs for logging
const UNKNOWN_POSITION_IDS = new Set<number>();
const UNKNOWN_LINEUP_SLOT_IDS = new Set<number>();

/**
 * Get position name from ESPN position ID
 */
export function getPositionName(positionId: number): string {
  const name = POSITION_MAP[positionId];
  if (name) return name;
  if (!UNKNOWN_POSITION_IDS.has(positionId)) {
    UNKNOWN_POSITION_IDS.add(positionId);
    console.warn(`[football-mappings] Unknown position ID: ${positionId}`);
  }
  return `POS_${positionId}`;
}

/**
 * Get lineup slot name from ESPN lineup slot ID
 */
export function getLineupSlotName(slotId: number): string {
  const name = LINEUP_SLOT_MAP[slotId];
  if (name) return name;
  if (!UNKNOWN_LINEUP_SLOT_IDS.has(slotId)) {
    UNKNOWN_LINEUP_SLOT_IDS.add(slotId);
    console.warn(`[football-mappings] Unknown lineup slot ID: ${slotId}`);
  }
  return `SLOT_${slotId}`;
}

/**
 * Get pro team abbreviation from team ID
 */
export function getProTeamAbbrev(teamId: number): string {
  return PRO_TEAM_MAP[teamId] || 'FA'; // FA = Free Agent (no team)
}

/**
 * Get injury status display name
 */
export function getInjuryStatus(status: string): string {
  return INJURY_STATUS_MAP[status] || status;
}

/**
 * Transform ESPN player eligible slots array to readable position names
 * Filters out bench/IR slots for cleaner output
 */
export function transformEligiblePositions(slots: number[]): string[] {
  return slots
    .map(slot => LINEUP_SLOT_MAP[slot])
    .filter((name): name is string => !!name && !['Bench', 'IR'].includes(name));
}
