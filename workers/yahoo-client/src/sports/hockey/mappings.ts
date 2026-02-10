// Yahoo position mappings for hockey

export const POSITION_MAP: Record<string, string> = {
  'C': 'Center',
  'LW': 'Left Wing',
  'RW': 'Right Wing',
  'D': 'Defense',
  'G': 'Goalie',
  'W': 'Wing',
  'F': 'Forward',
  'UTIL': 'Utility',
  'Util': 'Utility',
  'BN': 'Bench',
  'IR': 'Injured Reserve',
  'IR+': 'Injured Reserve+',
  'NA': 'Not Active',
};

export function getPositionName(posAbbrev: string): string {
  return POSITION_MAP[posAbbrev] || posAbbrev;
}

export const FA_POSITION_FILTER: Record<string, string> = {
  'ALL': '',
  'C': 'C',
  'LW': 'LW',
  'RW': 'RW',
  'D': 'D',
  'G': 'G',
  'W': 'W',
  'F': 'F',
};

export function getPositionFilter(position?: string): string {
  if (!position) return '';
  const key = position.toUpperCase();
  return FA_POSITION_FILTER[key] ?? '';
}
