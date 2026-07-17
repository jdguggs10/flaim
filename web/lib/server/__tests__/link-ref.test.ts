import { describe, expect, it } from 'vitest';
import { withEmailRef } from '../../../emails/link-ref';

describe('withEmailRef', () => {
  it('appends the ref param to a bare URL', () => {
    expect(withEmailRef('https://flaim.app/leagues', 'email-espn-setup-link')).toBe(
      'https://flaim.app/leagues?ref=email-espn-setup-link'
    );
  });

  it('preserves existing query params', () => {
    expect(withEmailRef('https://flaim.app/leagues?from=widget', 'email-aug-kickoff')).toBe(
      'https://flaim.app/leagues?from=widget&ref=email-aug-kickoff'
    );
  });

  it('rejects campaign names outside the allowed shape', () => {
    expect(() => withEmailRef('https://flaim.app/leagues', 'Email Blast!')).toThrow();
    expect(() => withEmailRef('https://flaim.app/leagues', '')).toThrow();
    expect(() => withEmailRef('https://flaim.app/leagues', '-leading-hyphen')).toThrow();
  });
});
