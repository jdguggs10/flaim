// Yahoo position abbreviations for baseball
export const POSITION_MAP: Record<string, string> = {
  'C': 'Catcher',
  '1B': 'First Base',
  '2B': 'Second Base',
  '3B': 'Third Base',
  'SS': 'Shortstop',
  'OF': 'Outfield',
  'Util': 'Utility',
  'SP': 'Starting Pitcher',
  'RP': 'Relief Pitcher',
  'P': 'Pitcher',
  'BN': 'Bench',
  'IL': 'Injured List',
  'IL+': 'Injured List+',
  'NA': 'Not Active',
};

export function getPositionName(posAbbrev: string): string {
  return POSITION_MAP[posAbbrev] || posAbbrev;
}

// Position abbreviations for Yahoo free agent filter
export const FA_POSITION_FILTER: Record<string, string> = {
  'ALL': '',
  'C': 'C',
  '1B': '1B',
  '2B': '2B',
  '3B': '3B',
  'SS': 'SS',
  'OF': 'OF',
  'SP': 'SP',
  'RP': 'RP',
  'P': 'P',
};

export function getPositionFilter(position?: string): string {
  if (!position) return '';
  const key = position.toUpperCase();
  return FA_POSITION_FILTER[key] ?? '';
}
