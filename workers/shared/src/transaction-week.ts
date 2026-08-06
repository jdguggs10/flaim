import { ErrorCode } from './errors.js';

export type TransactionPlatform = 'espn' | 'yahoo' | 'sleeper';

export type TransactionWeekValidation =
  | { ok: true; week: number | undefined }
  | {
      ok: false;
      success: false;
      code: typeof ErrorCode.INVALID_TRANSACTION_WINDOW;
      error: string;
      status: 400;
      retryable: false;
    };

function invalidTransactionWeek(error: string): Extract<TransactionWeekValidation, { ok: false }> {
  return {
    ok: false,
    success: false,
    code: ErrorCode.INVALID_TRANSACTION_WINDOW,
    error,
    status: 400,
    retryable: false,
  };
}

/**
 * Platform-aware public transaction-week validation.
 *
 * This is intentionally separate from the get_roster snapshot capability map:
 * transaction aggregates and point-in-time rosters have different selector
 * semantics.
 */
export function validateTransactionWeekInput(
  platform: TransactionPlatform,
  week: unknown
): TransactionWeekValidation {
  if (week === undefined) {
    return { ok: true, week: undefined };
  }

  if (typeof week !== 'number' || !Number.isFinite(week) || !Number.isInteger(week)) {
    return invalidTransactionWeek(
      platform === 'sleeper'
        ? 'Sleeper transaction week must be a finite positive integer (1 or later). Pass a matchup week of 1 or later, or omit week for the current and previous week.'
        : 'Transaction week must be a finite integer. Pass a valid platform week, or omit week for the default recent window.'
    );
  }

  if (platform === 'sleeper' && week < 1) {
    return invalidTransactionWeek(
      'Sleeper transaction week must be a positive integer (1 or later). Pass a matchup week of 1 or later, or omit week for the current and previous week.'
    );
  }

  if (week < 0) {
    return invalidTransactionWeek(
      platform === 'espn'
        ? 'ESPN transaction week must be 0 or later; week 0 is preseason. Omit week for the current and previous matchup periods.'
        : 'Yahoo transaction week must be 0 or later when provided. Yahoo ignores week and uses its recent timestamp window, so omit week unless preserving a compatible request.'
    );
  }

  return { ok: true, week };
}
