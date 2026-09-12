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
  it('has valid routing frontmatter and documents all eleven tools', () => {
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
      'With session context established, call `get_league_info` for the selected active league'
    );
    expect(skill).toContain('call `get_user_session` only when no usable successful session result is available in this chat');
    expect(skill).toContain('do not repeat it merely because a new user message arrived');
    expect(skill).toContain('when the user confirms account, connection, league-list, or default changes');
    expect(skill).toContain('when the needed session context is missing');
    expect(skill).toContain('A new chat needs its own session lookup');
    expect(skill).toContain('a failed session lookup is not reusable context');
    expect(skill).toContain('Reuse session context, not stale roster, score, or player data');
    expect(skill).toContain('Analysis sequences below show a fresh chat');
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
      'If a rate is missing, write "[Provider] market ownership rate: not provided"; do not print a missing response field name or null value, call `get_players`, or offer a lookup'
    );
    expect(skill).toContain(
      'A returned player is already confirmed available in the selected league'
    );
    expect(skill).toContain(
      'prefer the normalized fields over the legacy provider fields, which stay visible'
    );
    expect(skill).toContain('`ownershipScope` is `platform_global` or `unavailable`');
    expect(skill).toContain('rates are platform-wide, never league-scoped');
    expect(skill).toContain(
      'Normalized `team` is the real-life club, `null` when the provider lists none'
    );
    expect(skill).toContain(
      'prefer normalized `acquisitionState` (`free_agent` or `waivers`; `null` when undetermined) and `waiverClearsAt` (ISO 8601) over legacy `status`/`waiverProcessDate`'
    );
    expect(skill).toContain('Only ESPN reports fantasy acquisition state here');
    expect(skill).toContain(
      'Call Yahoo/Sleeper rows "available players," never specifically free agents or waivers'
    );
    expect(skill).toContain(
      'Hard stop: after satisfying a returned-list or field-explanation request, end the answer immediately after the requested facts'
    );
    expect(skill).toContain(
      'Pass a requested count exactly from 1 through 100; for more than 100, state the limit and ask the user to narrow the request or accept 100'
    );
    expect(skill).toContain(
      'An ESPN-wide started rate is never conditional on the player being rostered'
    );
    expect(skill).toContain(
      'Translate ownership scope silently into that provider-wide wording; never print the `ownershipScope` key, `platform_global` enum, or `get_free_agents` tool name'
    );
    expect(skill).toContain(
      'never append "if you want", "tell me which player", or a similar invitation unless the user\'s current request explicitly asks for that additional work'
    );
    expect(skill).toContain(
      'Render acquisition state silently in plain language; never print raw codes such as `FREEAGENT`, `WAIVERS`, or `free_agent`'
    );
    expect(skill).toContain(
      'Use `get_roster` only when the current request separately asks who owns a player; never offer it after an available-player result'
    );
    expect(skill).toContain('Use current web evidence before adding analysis or pickup recommendations');
    expect(skill.indexOf('Pass a requested count exactly from 1 through 100')).toBeGreaterThan(
      skill.indexOf('Returns players available to acquire in the selected fantasy league')
    );
    expect(skill.indexOf('Hard stop:')).toBeGreaterThan(
      skill.indexOf('Use current web evidence before adding analysis or pickup recommendations')
    );
    expect(skill).toContain(
      'Do not include `injuryStatus` or any injury detail unless the user asks for it; when asked, verify current web evidence and translate provider codes into plain language'
    );
  });

  it('gives Sleeper an authoritative get_players league-ownership path while keeping the market-ownership guardrail and ESPN/Yahoo conditionality', () => {
    // Scope rule 7
    expect(skill).toContain(
      'Never infer league ownership from `market_percent_owned`, `percentOwned`, or `ownership_scope`'
    );
    expect(skill).toContain(
      "On Sleeper, `get_players` always resolves league ownership against the selected league's current rosters"
    );
    expect(skill).toContain(
      'trust `league_team_id` (Sleeper-only), `league_status`, `league_team_name`, and `league_owner_name` directly'
    );
    expect(skill).toContain(
      'On ESPN and Yahoo those same `league_status`/`league_team_name`/`league_owner_name` fields populate only when credentials and league context allow'
    );

    // get_players tools-reference section
    expect(skill).toContain(
      "Sleeper always resolves league ownership against the selected league's current rosters and adds a Sleeper-only `league_team_id` (the Sleeper roster id, or `null`)"
    );
    expect(skill).toContain(
      "Sleeper's market/global ownership stays unavailable (`market_percent_owned: null`, `ownership_scope: \"unavailable\"`)"
    );

    // Updated worked example
    expect(skill).toContain(
      '"Who owns Player X in my league?" → Sleeper: `get_user_session` → `get_league_info` → `get_players` (trust `league_status`/`league_team_id`/`league_team_name`/`league_owner_name` directly). ESPN/Yahoo: `get_user_session` → `get_league_info` + `get_roster` per team (never use `market_percent_owned`, `percentOwned`, or `ownership_scope` as league ownership)'
    );

    // Superseded phrasing must be gone
    expect(skill).not.toContain('do not use `get_players` market ownership as league ownership');

    // The verbatim "Ben Rice" worked example must survive untouched.
    expect(skill).toContain(
      '"Find the right Ben Rice and show market ownership context" → `get_user_session` → `get_league_info` → `get_players`'
    );

    // Active-draft exception (FLA-382 cross-model audit fix 2) and league_status-keyed fallback (fix 1)
    expect(skill).toContain('except during an active draft');
    expect(skill).toContain(
      'Fall back to `get_roster` only when `league_status` itself is absent or null'
    );
  });
});
