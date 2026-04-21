import { describe, expect, it } from 'vitest';
import { getPathname, stripPrefix } from '../prefix-strip.js';

describe('stripPrefix', () => {
  it('strips when pathname exactly matches prefix', () => {
    expect(stripPrefix('/baseball', '/baseball')).toBe('/');
  });

  it('strips when pathname starts with prefix plus slash', () => {
    expect(stripPrefix('/baseball/health', '/baseball')).toBe('/health');
  });

  it('does not strip when pathname only shares a partial prefix', () => {
    expect(stripPrefix('/baseballish/health', '/baseball')).toBe('/baseballish/health');
  });

  it('normalizes prefix without leading slash', () => {
    expect(stripPrefix('/baseball/health', 'baseball')).toBe('/health');
  });

  it('normalizes prefix with trailing slash', () => {
    expect(stripPrefix('/baseball/health', '/baseball/')).toBe('/health');
  });
});

describe('getPathname', () => {
  it('returns parsed pathname with prefix stripping applied', () => {
    const request = new Request('https://example.com/baseball/standings?league=123');
    expect(getPathname(request, '/baseball')).toBe('/standings');
  });

  it('returns pathname unchanged when no prefix is provided', () => {
    const request = new Request('https://example.com/baseball/standings?league=123');
    expect(getPathname(request)).toBe('/baseball/standings');
  });
});
