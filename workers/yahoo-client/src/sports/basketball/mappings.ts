// Yahoo position mappings for basketball

export const POSITION_MAP: Record<string, string> = {
  'PG': 'Point Guard',
  'SG': 'Shooting Guard',
  'SF': 'Small Forward',
  'PF': 'Power Forward',
  'C': 'Center',
  'G': 'Guard',
  'F': 'Forward',
  'UTIL': 'Utility',
  'Util': 'Utility',
  'BN': 'Bench',
  'IR': 'Injured Reserve',
  'IR+': 'Injured Reserve+',
  'IL': 'Injured List',
  'IL+': 'Injured List+',
};

export function getPositionName(posAbbrev: string): string {
  return POSITION_MAP[posAbbrev] || posAbbrev;
}

export const FA_POSITION_FILTER: Record<string, string> = {
  'ALL': '',
  'PG': 'PG',
  'SG': 'SG',
  'SF': 'SF',
  'PF': 'PF',
  'C': 'C',
  'G': 'G',
  'F': 'F',
  'UTIL': 'Util',
};

export function getPositionFilter(position?: string): string {
  if (!position) return '';
  const key = position.toUpperCase();
  return FA_POSITION_FILTER[key] ?? '';
}
