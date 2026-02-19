// Sleeper NFL position abbreviations
export const POSITION_MAP: Record<string, string> = {
  'QB': 'Quarterback',
  'RB': 'Running Back',
  'WR': 'Wide Receiver',
  'TE': 'Tight End',
  'K': 'Kicker',
  'DEF': 'Defense/Special Teams',
  'DL': 'Defensive Lineman',
  'LB': 'Linebacker',
  'DB': 'Defensive Back',
  'FLEX': 'Flex (RB/WR/TE)',
  'SUPER_FLEX': 'Superflex (QB/RB/WR/TE)',
  'REC_FLEX': 'Receiving Flex (WR/TE)',
  'IDP_FLEX': 'IDP Flex',
  'BN': 'Bench',
  'IR': 'Injured Reserve',
  'TAXI': 'Taxi Squad',
};

export function getPositionName(posAbbrev: string): string {
  return POSITION_MAP[posAbbrev] || posAbbrev;
}
