export interface SeasonCounts {
  found: number;
  added: number;
  alreadySaved: number;
  refreshed: number;
}

export function normalizeSeasonCountValue(value: unknown): number | null {
  // Missing count fields mean zero; present-but-invalid fields make the worker response malformed.
  if (value === undefined || value === null) return 0;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function normalizeSeasonCounts(value: unknown): SeasonCounts | null {
  if (value === undefined || value === null) {
    return { found: 0, added: 0, alreadySaved: 0, refreshed: 0 };
  }

  if (typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const found = normalizeSeasonCountValue(record.found);
  const added = normalizeSeasonCountValue(record.added);
  const alreadySaved = normalizeSeasonCountValue(record.alreadySaved);
  const refreshed = normalizeSeasonCountValue(record.refreshed);

  if (found === null || added === null || alreadySaved === null || refreshed === null) return null;

  return { found, added, alreadySaved, refreshed };
}

export function normalizeWorkerErrorStatus(status: number): number {
  if (status === 401 || status === 403 || status === 429) return status;
  return 502;
}
