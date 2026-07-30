import { describe, expect, it } from 'vitest';
import { validateTransactionWeekInput } from '../transaction-week.js';

describe('validateTransactionWeekInput', () => {
  it.each([
    ['espn', undefined, undefined],
    ['espn', 0, 0],
    ['espn', 4, 4],
    ['yahoo', undefined, undefined],
    ['yahoo', 0, 0],
    ['sleeper', undefined, undefined],
    ['sleeper', 1, 1],
    ['sleeper', 12, 12],
  ] as const)('accepts %s week %s', (platform, week, expected) => {
    expect(validateTransactionWeekInput(platform, week)).toEqual({ ok: true, week: expected });
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['null', null],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
  ])('rejects Sleeper %s week without normalizing it', (_label, week) => {
    const result = validateTransactionWeekInput('sleeper', week);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_TRANSACTION_WINDOW');
      expect(result.status).toBe(400);
      expect(result.retryable).toBe(false);
      expect(result.error).toContain('positive integer');
      expect(result.error).toContain('1 or later');
      expect(result.error).toContain('omit week');
    }
  });

  it.each([
    ['espn', -1],
    ['yahoo', -1],
    ['espn', 2.5],
    ['yahoo', Number.NaN],
  ] as const)('rejects invalid %s week %s', (platform, week) => {
    const result = validateTransactionWeekInput(platform, week);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_TRANSACTION_WINDOW');
      expect(result.status).toBe(400);
    }
  });
});
