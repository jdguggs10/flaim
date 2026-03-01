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
  6: 'D/ST',   // Defense/Special Teams (IDP)
  8: 'DT',     // Defensive Tackle (IDP)
  9: 'DE',     // Defensive End (IDP)
  10: 'LB',    // Linebacker (IDP)
  11: 'CB',    // Cornerback (IDP)
  12: 'S',     // Safety (IDP)
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

// STATS_MAP: ESPN stat IDs to readable stat names
// Verified against cwendt94/espn-api constant.py (2026-01-23)
// See MAPPINGS.md for derivation details
export const STATS_MAP: Record<number, string> = {
  // --- Passing (0-22) ---
  0: 'passAtt',       // Passing Attempts
  1: 'passCmp',       // Passing Completions
  2: 'passInc',       // Passing Incompletions
  3: 'passYds',       // Passing Yards
  4: 'passTD',        // Passing Touchdowns
  15: 'pass40TD',     // 40+ Yard Passing TD
  16: 'pass50TD',     // 50+ Yard Passing TD
  17: 'pass300',      // 300-399 Yard Passing Game
  18: 'pass400',      // 400+ Yard Passing Game
  19: 'pass2PT',      // Passing 2PT Conversions
  20: 'passINT',      // Passing Interceptions
  21: 'passCmpPct',   // Passing Completion Percentage

  // --- Rushing (23-40) ---
  23: 'rushAtt',      // Rushing Attempts
  24: 'rushYds',      // Rushing Yards
  25: 'rushTD',       // Rushing Touchdowns
  26: 'rush2PT',      // Rushing 2PT Conversions
  35: 'rush40TD',     // 40+ Yard Rushing TD
  36: 'rush50TD',     // 50+ Yard Rushing TD
  37: 'rush100',      // 100-199 Yard Rushing Game
  38: 'rush200',      // 200+ Yard Rushing Game
  39: 'rushYPA',      // Rushing Yards Per Attempt

  // --- Receiving (41-61) ---
  41: 'rec',          // Receptions
  42: 'recYds',       // Receiving Yards
  43: 'recTD',        // Receiving Touchdowns
  44: 'rec2PT',       // Receiving 2PT Conversions
  45: 'rec40TD',      // 40+ Yard Receiving TD
  46: 'rec50TD',      // 50+ Yard Receiving TD
  53: 'recTgt',       // Receiving Targets (alt ID)
  56: 'rec100',       // 100-199 Yard Receiving Game
  57: 'rec200',       // 200+ Yard Receiving Game
  58: 'recTgt',       // Receiving Targets
  59: 'recYAC',       // Receiving Yards After Catch
  60: 'recYPR',       // Receiving Yards Per Reception

  // --- Misc Offense (62-73) ---
  62: 'conv2PT',      // 2PT Conversions (any)
  63: 'fumRetTD',     // Fumble Recovered for TD
  64: 'sacked',       // Times Sacked
  68: 'fum',          // Fumbles
  72: 'fumLost',      // Fumbles Lost
  73: 'TO',           // Turnovers

  // --- Kicking (74-88) ---
  74: 'FG50A',        // 50+ Yard FG Attempts
  75: 'FG50M',        // 50+ Yard FG Made
  76: 'FG50Ms',       // 50+ Yard FG Missed
  77: 'FG40A',        // 40-49 Yard FG Attempts
  78: 'FG40M',        // 40-49 Yard FG Made
  79: 'FG40Ms',       // 40-49 Yard FG Missed
  80: 'FG0A',         // 0-39 Yard FG Attempts
  81: 'FG0M',         // 0-39 Yard FG Made
  82: 'FG0Ms',        // 0-39 Yard FG Missed
  83: 'FGA',          // Total FG Attempts
  84: 'FGM',          // Total FG Made
  85: 'FGMs',         // Total FG Missed
  86: 'XPA',          // Extra Point Attempts
  87: 'XPM',          // Extra Points Made
  88: 'XPMs',         // Extra Points Missed

  // --- Defense/ST (89-136) ---
  89: 'defBlkKick',   // Blocked Kicks
  90: 'defINT',       // Interceptions
  91: 'defFumRec',    // Fumbles Recovered
  92: 'defSack',      // Sacks
  93: 'defSafety',    // Safeties
  95: 'defTD',        // Defensive TDs
  96: 'defPtsAllow',  // Points Allowed
  97: 'defPts0',      // 0 Points Allowed
  98: 'defPts1_6',    // 1-6 Points Allowed
  99: 'defPts7_13',   // 7-13 Points Allowed
  100: 'defPts14_17', // 14-17 Points Allowed
  101: 'defPts18_21', // 18-21 Points Allowed
  102: 'defPts22_27', // 22-27 Points Allowed
  103: 'defPts28_34', // 28-34 Points Allowed
  104: 'defPts35_45', // 35-45 Points Allowed
  105: 'defPts46',    // 46+ Points Allowed
  106: 'defYdsAllow', // Total Yards Allowed
  107: 'defPassYds',  // Passing Yards Allowed
  108: 'defRushYds',  // Rushing Yards Allowed
  109: 'defTackSolo', // Solo Tackles
  110: 'defTackAst',  // Assisted Tackles
  111: 'defTackTot',  // Total Tackles
  113: 'defPassDef',  // Passes Defensed
  120: 'defYds0_99',  // Less than 100 Yards Allowed
  121: 'defYds100',   // 100-199 Yards Allowed
  122: 'defYds200',   // 200-299 Yards Allowed
  123: 'defYds300',   // 300-349 Yards Allowed
  124: 'defYds350',   // 350-399 Yards Allowed
  125: 'defYds400',   // 400-449 Yards Allowed
  126: 'defYds450',   // 450-499 Yards Allowed
  127: 'defYds500',   // 500-549 Yards Allowed
  128: 'defYds550',   // 550+ Yards Allowed
  129: 'stKickRetTD', // Kick Return TD
  130: 'stPuntRetTD', // Punt Return TD
  131: 'stFumRetTD',  // Fumble Return TD
  132: 'stIntRetTD',  // Interception Return TD
  133: 'stBlkKickTD', // Blocked Kick Return TD
  134: 'stKickRetYds',// Kick Return Yards
  135: 'stPuntRetYds',// Punt Return Yards

  // --- Head Coach (155+) ---
  155: 'hcWin',       // Team Win
  156: 'hcLoss',      // Team Loss
  157: 'hcTie',       // Team Tie
  158: 'hcPts25',     // 25+ Point Win
  159: 'hcPts20',     // 20-24 Point Win
  160: 'hcPts15',     // 15-19 Point Win
  161: 'hcPts10',     // 10-14 Point Win
  162: 'hcPts5',      // 5-9 Point Win
  163: 'hcPts1',      // 1-4 Point Win
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

/**
 * Get stat name from ESPN stat ID
 */
export function getStatName(statId: number): string {
  return STATS_MAP[statId] || `STAT_${statId}`;
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
