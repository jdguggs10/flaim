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
