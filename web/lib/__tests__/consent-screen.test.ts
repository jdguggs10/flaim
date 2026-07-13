import { describe, expect, it } from 'vitest';
import { getConsentContent } from '@/components/site/connectors/ConsentScreen';

describe('getConsentContent', () => {
  it('describes read-only access without promising league refresh', () => {
    const content = getConsentContent('mcp:read');

    expect(content.description).toContain('read-only access');
    expect(content.permissions).toContain('Read-only access - cannot modify your teams or Flaim league list');
    expect(content.permissions.join(' ')).not.toContain('Refresh Flaim');
  });

  it('distinguishes Flaim league refresh from read-only provider access', () => {
    const content = getConsentContent('mcp:read mcp:write');

    expect(content.description).toContain('refresh your Flaim league list');
    expect(content.permissions).toContain("Refresh may add or update Flaim's connected-league records, including newly available seasons and renamed leagues");
    expect(content.permissions).toContain('Provider access remains read-only - cannot change teams on ESPN, Yahoo, or Sleeper');
  });
});
