import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repoFile = (relativePath: string) =>
  readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), 'utf8');

const activeFactSurfaces = [
  '.agents/skills/flaim-fantasy/SKILL.md',
  'README.md',
  'docs/ARCHITECTURE.md',
  'docs/CONNECTOR-DOCS.md',
  'web/README.md',
  'web/app/(site)/guide/platforms/page.tsx',
  'web/app/(site)/privacy/page.tsx',
  'workers/README.md',
  'workers/espn-client/README.md',
  'workers/fantasy-mcp/README.md',
  'workers/fantasy-mcp/src/mcp/instructions.ts',
  'workers/fantasy-mcp/src/mcp/tools.ts',
  'workers/yahoo-client/README.md',
] as const;

describe('active product-fact surfaces', () => {
  it.each(activeFactSurfaces)('%s contains no retired ESPN setup or expiry guidance', (path) => {
    const text = repoFile(path);

    expect(text).not.toMatch(
      /manual ESPN onboarding|Chrome extension or manual cookies|enter cookies manually|re-enter cookies/i
    );
    expect(text).not.toMatch(
      /ESPN[^\n.]{0,120}(?:cookies?|credentials?)[^\n.]{0,120}(?:expire|expired|expiration)|(?:cookies?|credentials?)[^\n.]{0,120}(?:expire|expired|expiration)[^\n.]{0,120}ESPN/i
    );
  });

  it.each(activeFactSurfaces)('%s contains no retired scope or usage-limit claims', (path) => {
    const text = repoFile(path);

    expect(text).not.toContain('Football and basketball only (Phase 1)');
    expect(text).not.toMatch(/200 MCP calls per day|200 calls\/day/i);
    expect(text).not.toMatch(
      /Yahoo[^\n.]{0,160}type=waiver[^\n.]{0,160}(?:unsupported|not supported)|type=waiver[^\n.]{0,160}(?:unsupported|not supported)[^\n.]{0,160}Yahoo/i
    );
  });

  it('emits a neutral ESPN authentication code on public worker errors', () => {
    const source = repoFile('workers/espn-client/src/shared/espn-api.ts');

    expect(source).toContain('ESPN_AUTHENTICATION_FAILED:');
    expect(source).not.toContain('ESPN_COOKIES_EXPIRED:');
  });

  it.each([
    'docs/ARCHITECTURE.md',
    'docs/CONNECTOR-DOCS.md',
    'workers/README.md',
    'workers/fantasy-mcp/README.md',
    'workers/yahoo-client/README.md',
  ])('%s documents Yahoo authenticated-team pending transaction filters', (path) => {
    const text = repoFile(path);

    expect(text).toContain('type=waiver');
    expect(text).toContain('type=pending_trade');
    expect(text).toMatch(/authenticated user(?:'s)? own team/i);
  });
});
