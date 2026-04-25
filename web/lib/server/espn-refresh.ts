export interface SeasonCounts {
  found: number;
  added: number;
  alreadySaved: number;
}

export function normalizeSeasonCountValue(value: unknown): number | null {
  // Missing count fields mean zero; present-but-invalid fields make the worker response malformed.
  if (value === undefined || value === null) return 0;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeSeasonCounts(value: unknown): SeasonCounts | null {
  if (value === undefined || value === null) {
    return { found: 0, added: 0, alreadySaved: 0 };
  }

  if (typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const found = normalizeSeasonCountValue(record.found);
  const added = normalizeSeasonCountValue(record.added);
  const alreadySaved = normalizeSeasonCountValue(record.alreadySaved);

  if (found === null || added === null || alreadySaved === null) return null;

  return { found, added, alreadySaved };
}

export function normalizeWorkerErrorStatus(status: number): number {
  if (status === 401 || status === 403 || status === 429) return status;
  if (status >= 500) return 502;
  return status >= 400 ? status : 502;
}
