// workers/espn-client/src/shared/dates.ts

/**
 * Convert an ESPN epoch-milliseconds field to an ISO 8601 string, guarding
 * against every non-numeric shape the JSON payload could hand us (FLA-284
 * audit: `new Date(x).toISOString()` was previously called unguarded on
 * `keeperSettings.keeperDeadlineDate` and `tradeSettings.deadlineDate`,
 * which throws on non-finite input and silently produces `null` for a
 * merely-absent source block instead of leaving the field `undefined`).
 *
 * - A positive finite number converts to an ISO string.
 * - `null` (ESPN explicitly reports "no date set", e.g. an unset trade or
 *   keeper deadline) passes through as `null`.
 * - `undefined` (the source block/field is absent from the payload) passes
 *   through as `undefined` so the field can be omitted like its siblings.
 * - Anything else — `NaN`, non-finite numbers, `0`/negative numbers,
 *   strings, objects, arrays — is treated as "not a valid date" and
 *   normalized to `null` rather than thrown or guessed at.
 */
export function epochMsToIso(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }
  return null;
}
