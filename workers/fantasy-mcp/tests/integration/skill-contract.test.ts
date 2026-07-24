import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const skill = readFileSync(
  new URL('../../../../.agents/skills/flaim-fantasy/SKILL.md', import.meta.url),
  'utf8'
);

const expectedTools = [
  'get_user_session',
  'refresh_leagues',
  'get_ancient_history',
  'get_league_info',
  'get_standings',
  'get_matchups',
  'get_roster',
  'get_free_agents',
  'get_players',
  'get_transactions',
];

describe('shipped Flaim fantasy skill contract', () => {
  it('has valid routing frontmatter and documents all ten tools', () => {
    expect(skill).toMatch(/^---\nname: flaim-fantasy\ndescription: .+\nlicense: MIT\n---/);
    const description = skill.match(/^description: (.+)$/m)?.[1] ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).toContain('Use when');
    expect(description).toContain('Do not use');

    for (const tool of expectedTools) {
      expect(skill).toContain(`### \`${tool}\``);
    }
  });

  it('locks tool-free capability, setup, weather, and coding or scraping paths', () => {
    expect(skill).toContain('Generic setup how-to, capability, or permission questions are a separate tool-free path');
    expect(skill).toContain('Do not call Flaim tools for generic coding or scraping requests, weather');
    expect(skill).toContain('"Can Flaim change my lineup?" → no tools');
    expect(skill).toContain('web search only, no Flaim tools needed');
  });

  it('distinguishes generic setup from user-specific connection status', () => {
    expect(skill).toContain('"How do I connect Yahoo?" → no tools');
    expect(skill).toContain('"Is my Yahoo league connected?" → `get_user_session`');
    expect(skill).toContain('"Which leagues do I have connected?" → `get_user_session`');
  });

  it('locks the provider-write boundary and refresh exception', () => {
    expect(skill).toContain('submit waiver claims or trades');
    expect(skill).toContain('User permission does not change this boundary');
    expect(skill).toContain('`refresh_leagues` is the only bounded write tool');
    expect(skill).toContain('"Refresh my connected leagues" → `refresh_leagues` → `get_user_session`');
    expect(skill).toContain('"Add a league" → no tools; guide the user to https://flaim.app/leagues');
    expect(skill).not.toContain('All tools are read-only');
    expect(skill).not.toContain('Flaim is strictly read-only');
    expect(skill).not.toContain('200 MCP calls per day');
    expect(skill).not.toContain('type=waiver filtering is not supported');
  });

  it('locks current connection, sport, retry, and league-management facts', () => {
    expect(skill).toContain('captured via the Flaim Chrome extension');
    expect(skill).not.toMatch(/cookies? expire/i);
    expect(skill).not.toMatch(/re-enter cookies|manual entry/i);
    expect(skill).toContain('- **Sports:** Football and basketball.');
    expect(skill).not.toContain('Football and basketball only (Phase 1)');
    expect(skill).toContain('one retry with the same inputs is reasonable');
    expect(skill).toContain('Do not retry in a loop');
    expect(skill).toContain('do not offer another attempt until the user confirms');
    expect(skill).toContain("follow the MCP client's connect or reauthorization flow");
    expect(skill).toContain('network timeout or explicitly temporary provider/Flaim service failure');
    expect(skill).not.toContain('After an authentication, connection, or missing-league error');
    expect(skill).not.toContain('the result will be the same');
    expect(skill).toContain('Do not ask the user to verify or provide numeric league IDs or season values');
    expect(skill).toContain('https://flaim.app/leagues');
  });

  it('locks the ordinary selected-league sequence', () => {
    expect(skill).toContain(
      'For a selected active league, call `get_league_info` immediately after `get_user_session`'
    );
    expect(skill).toContain(
      '"What are the standings in my league?" → `get_user_session` → `get_league_info` → `get_standings`'
    );
    expect(skill).toContain(
      '"Show me this week\'s matchup" → `get_user_session` → `get_league_info` → `get_matchups`'
    );
    expect(skill).toContain(
      '"Find the right Ben Rice and show market ownership context" → `get_user_session` → `get_league_info` → `get_players`'
    );
  });

  it('keeps fantasy availability distinct from professional, market, and waiver context', () => {
    expect(skill).toContain('available to acquire in the selected fantasy league');
    expect(skill).toContain('not players who are unsigned professionally');
    expect(skill).toContain(
      'ESPN `percentOwned`/`percentStarted` are the percentages of all ESPN leagues where the player is rostered/started'
    );
    expect(skill).toContain('Yahoo `percentOwned`, when present, is Yahoo-wide');
    expect(skill).toContain(
      'Label every reported percentage as an ESPN-wide roster/start rate or Yahoo-wide market rate'
    );
    expect(skill).toContain(
      'If a rate is missing, write "[Provider] market ownership rate: not provided"; do not repeat response field names or null values, call `get_players`, or offer a lookup'
    );
    expect(skill).toContain(
      'A returned player is already confirmed available in the selected league'
    );
    expect(skill).toContain('`team`/`proTeam` is the real-life club');
    expect(skill).toContain('Only ESPN `status`/`waiverProcessDate` represents fantasy acquisition state');
    expect(skill).toContain(
      'Call Yahoo/Sleeper rows "available players," never specifically free agents or waivers'
    );
    expect(skill).toContain('For a returned list or field explanation, end after the requested facts');
    expect(skill).toContain('never add an "if you want" offer');
    expect(skill).toContain(
      'Translate ESPN status codes silently into plain language; never print raw codes such as `FREEAGENT` or `WAIVERS`'
    );
    expect(skill).toContain('Use `get_roster` for a separate player-ownership question');
    expect(skill).toContain('Use current web evidence before adding analysis or pickup recommendations');
  });
});
