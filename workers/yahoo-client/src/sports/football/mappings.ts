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
};

export function getPositionFilter(position?: string): string {
  if (!position) return '';
  const key = position.toUpperCase();
  return FA_POSITION_FILTER[key] ?? '';
}
