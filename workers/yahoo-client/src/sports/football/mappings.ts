// Yahoo position IDs to readable names (football)
export const POSITION_MAP: Record<string, string> = {
  'QB': 'Quarterback',
  'WR': 'Wide Receiver',
  'RB': 'Running Back',
  'TE': 'Tight End',
  'K': 'Kicker',
  'DEF': 'Defense/Special Teams',
  'W/R': 'WR/RB Flex',
  'W/R/T': 'WR/RB/TE Flex',
  'W/T': 'WR/TE Flex',
  'Q/W/R/T': 'Superflex',
  'BN': 'Bench',
  'IR': 'Injured Reserve',
};

export function getPositionName(posAbbrev: string): string {
  return POSITION_MAP[posAbbrev] || posAbbrev;
}

// Position abbreviations for Yahoo free agent filter
// Yahoo accepts these directly in the ;position= parameter
export const FA_POSITION_FILTER: Record<string, string> = {
  'ALL': '',           // No filter
  'QB': 'QB',
  'WR': 'WR',
  'RB': 'RB',
  'TE': 'TE',
  'K': 'K',
  'DEF': 'DEF',
  'FLEX': 'W/R/T',     // Maps to Yahoo's flex designation
  // IDP (individual defensive player) positions — only present in leagues
  // with defensive roster slots enabled. Yahoo's roster/display_position
  // already surfaces these codes (see get-roster.ts, which passes them
  // through unmapped); without an entry here getPositionFilter fell back to
  // "no filter" and get_free_agents/get_players returned unfiltered
  // top-owned players instead of an error or the requested position.
  'D': 'D',
  'DL': 'DL',
  'DE': 'DE',
  'DT': 'DT',
  'LB': 'LB',
  'DB': 'DB',
  'CB': 'CB',
  'S': 'S',
};

export function getPositionFilter(position?: string): string {
  if (!position) return '';
  const key = position.toUpperCase();
  return FA_POSITION_FILTER[key] ?? '';
}
