// Sleeper NBA position abbreviations
export const POSITION_MAP: Record<string, string> = {
  'PG': 'Point Guard',
  'SG': 'Shooting Guard',
  'SF': 'Small Forward',
  'PF': 'Power Forward',
  'C': 'Center',
  'G': 'Guard',
  'F': 'Forward',
  'UTIL': 'Utility',
  'BN': 'Bench',
  'IR': 'Injured Reserve',
  'TAXI': 'Taxi Squad',
};

export function getPositionName(posAbbrev: string): string {
  return POSITION_MAP[posAbbrev] || posAbbrev;
}
