// workers/espn-client/src/sports/hockey/mappings.ts

/**
 * Hockey data transforms for ESPN API responses
 * Maps ESPN's numeric IDs to human-readable names
 *
 * Source: cwendt94/espn-api constant.py (hockey)
 * Verified: NOT YET -- no live league credentials available
 */

// Position IDs to position names
// Used for both defaultPositionId and lineupSlotId/eligibleSlots
export const POSITION_MAP: Record<number, string> = {
  0: 'C',      // Center
  1: 'LW',     // Left Wing
  2: 'RW',     // Right Wing
  3: 'F',      // Forward (C/LW/RW flex)
  4: 'D',      // Defense
  5: 'G',      // Goalie
  6: 'UTIL',   // Utility
  7: 'Bench',  // Bench
  8: 'IR',     // Injured Reserve
};

// Alias for consistency with football/baseball handler imports
export const LINEUP_SLOT_MAP = POSITION_MAP;

// Pro team IDs to team abbreviations (NHL teams)
// Source: cwendt94/espn-api constant.py
// Note: ESPN uses large IDs for expansion teams (Seattle, Utah)
export const PRO_TEAM_MAP: Record<number, string> = {
  0: 'FA',        // Free Agent
  1: 'BOS',       // Boston Bruins
  2: 'BUF',       // Buffalo Sabres
  3: 'CGY',       // Calgary Flames
  4: 'CHI',       // Chicago Blackhawks
  5: 'DET',       // Detroit Red Wings
  6: 'EDM',       // Edmonton Oilers
  7: 'CAR',       // Carolina Hurricanes
  8: 'LAK',       // Los Angeles Kings
  9: 'DAL',       // Dallas Stars
  10: 'MTL',      // Montreal Canadiens
  11: 'NJD',      // New Jersey Devils
  12: 'NYI',      // New York Islanders
  13: 'NYR',      // New York Rangers
  14: 'OTT',      // Ottawa Senators
  15: 'PHI',      // Philadelphia Flyers
  16: 'PIT',      // Pittsburgh Penguins
  17: 'COL',      // Colorado Avalanche
  18: 'SJS',      // San Jose Sharks
  19: 'STL',      // St. Louis Blues
  20: 'TBL',      // Tampa Bay Lightning
  21: 'TOR',      // Toronto Maple Leafs
  22: 'VAN',      // Vancouver Canucks
  23: 'WSH',      // Washington Capitals
  24: 'ARI',      // Arizona Coyotes (may be deprecated -- see Utah)
  25: 'ANA',      // Anaheim Ducks
  26: 'FLA',      // Florida Panthers
  27: 'NSH',      // Nashville Predators
  28: 'WPG',      // Winnipeg Jets
  29: 'CBJ',      // Columbus Blue Jackets
  30: 'MIN',      // Minnesota Wild
  37: 'VGK',      // Vegas Golden Knights
  124292: 'SEA',  // Seattle Kraken
  129764: 'UTA',  // Utah Hockey Club
};

// Injury status codes
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
export const POSITION_SLOTS: Record<string, number[]> = {
  'C': [0],
  'LW': [1],
  'RW': [2],
  'F': [3],
  'D': [4],
  'G': [5],
  'UTIL': [6],
  'ALL': [0, 1, 2, 3, 4, 5, 6],
};

// STATS_MAP: ESPN stat IDs to readable stat names
// Source: cwendt94/espn-api constant.py (hockey)
// UNVERIFIED -- no live league credentials
// Note: IDs 0-12 are goalie stats, 13+ are skater stats
export const SKATER_STATS_MAP: Record<number, string> = {
  13: 'G',      // Goals
  14: 'A',      // Assists
  15: '+/-',    // Plus/Minus
  17: 'PIM',    // Penalty Minutes
  18: 'PPG',    // Power Play Goals
  19: 'PPA',    // Power Play Assists
  20: 'SHG',    // Short-Handed Goals
  21: 'SHA',    // Short-Handed Assists
  22: 'GWG',    // Game-Winning Goals
  23: 'FOW',    // Faceoffs Won
  24: 'FOL',    // Faceoffs Lost
  27: 'ATOI',   // Average Time On Ice
  28: 'HAT',    // Hat Tricks
  29: 'SOG',    // Shots On Goal
  31: 'HIT',    // Hits
  32: 'BLK',    // Blocked Shots
  33: 'DEF',    // Defenseman Points (?)
  34: 'GP',     // Games Played
  35: 'STPG',   // Shorthanded Time Per Game
  36: 'STPA',   // Shorthanded Time Per Appearance
  37: 'STP',    // Special Teams Points (?)
  38: 'PPP',    // Power Play Points
  39: 'SHP',    // Short-Handed Points
};

export const GOALIE_STATS_MAP: Record<number, string> = {
  0: 'GS',     // Games Started
  1: 'W',      // Wins
  2: 'L',      // Losses
  3: 'SA',     // Shots Against
  4: 'GA',     // Goals Against
  6: 'SV',     // Saves
  7: 'SO',     // Shutouts
  9: 'OTL',    // Overtime Losses
  10: 'GAA',   // Goals Against Average
  11: 'SV%',   // Save Percentage
};

// Track unknown IDs for logging
const UNKNOWN_POSITION_IDS = new Set<number>();
const UNKNOWN_LINEUP_SLOT_IDS = new Set<number>();

export function getPositionName(positionId: number): string {
  const name = POSITION_MAP[positionId];
  if (name) return name;
  if (!UNKNOWN_POSITION_IDS.has(positionId)) {
    UNKNOWN_POSITION_IDS.add(positionId);
    console.warn(`[hockey-mappings] Unknown position ID: ${positionId}`);
  }
  return `POS_${positionId}`;
}

export function getLineupSlotName(slotId: number): string {
  const name = LINEUP_SLOT_MAP[slotId];
  if (name) return name;
  if (!UNKNOWN_LINEUP_SLOT_IDS.has(slotId)) {
    UNKNOWN_LINEUP_SLOT_IDS.add(slotId);
    console.warn(`[hockey-mappings] Unknown lineup slot ID: ${slotId}`);
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

/**
 * Get stat name from ESPN stat ID
 * IDs 0-12: Goalie stats
 * IDs 13+: Skater stats
 */
export function getStatName(statId: number): string {
  if (statId < 13) {
    return GOALIE_STATS_MAP[statId] || `STAT_${statId}`;
  }
  return SKATER_STATS_MAP[statId] || `STAT_${statId}`;
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
