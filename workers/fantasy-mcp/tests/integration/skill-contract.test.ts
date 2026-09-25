import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repoFile = (relativePath: string) =>
  readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), 'utf8');

const skill = repoFile('.agents/skills/flaim-fantasy/SKILL.md');
const toolsSource = repoFile('workers/fantasy-mcp/src/mcp/tools.ts');
const instructions = repoFile('workers/fantasy-mcp/src/mcp/instructions.ts');

/**
 * The shipped skill is the analyst playbook: judgment, refusal posture, and the
 * context-gathering backbone. Tool mechanics (parameters, response fields,
 * provider quirks, wording prohibitions, error codes) live in the tool
 * descriptions and the server instructions, which every MCP client reads live.
 * These tests pin the safety-critical posture in the skill and assert the
 * mechanics are not duplicated back into it.
 */
describe('shipped Flaim fantasy skill contract', () => {
  it('has valid routing frontmatter', () => {
    expect(skill).toMatch(/^---\nname: flaim-fantasy\ndescription: .+\nlicense: MIT\n---/);
    const description = skill.match(/^description: (.+)$/m)?.[1] ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).toContain('Use when');
    expect(description).toContain('Do not use');
  });

  it('locks the provider-write boundary and the refresh exception', () => {
    expect(skill).toContain('Flaim cannot change anything on ESPN, Yahoo, or Sleeper');
    expect(skill).toContain('submit waiver claims or trades');
    expect(skill).toContain('User permission does not change this boundary');
    expect(skill).toContain('without calling any tool');
    // One principle decides when tools are called. It must cover execute
    // requests ("use Flaim to swap my lineup") and forbid a session lookup
    // before the refusal (production evidence 2026-09-24).
    expect(skill).toContain("Call a Flaim tool only when the answer depends on the user's own league data");
    expect(skill).toContain('a request to change something on ESPN, Yahoo, or Sleeper');
    expect(skill).toContain('without calling any tool, including `get_user_session`');
    expect(skill).toContain('asks Flaim to make it');
    expect(skill).not.toContain('`get_user_session`, at the start,');
    expect(skill).toContain('the user has to make the change themselves on ESPN, Yahoo, or Sleeper');
    expect(skill).toContain('Never describe the limit as uncertain or conditional');
    expect(skill).toContain('`refresh_leagues` is the only bounded write tool');
    expect(skill).toContain('changes nothing on a provider');
    expect(skill).not.toContain('All tools are read-only');
    expect(skill).not.toContain('Flaim is strictly read-only');
  });

  it('locks the tool-free setup path and separates it from account state', () => {
    expect(skill).toContain(
      'Generic setup how-to, capability, or permission questions are a separate tool-free path'
    );
    expect(skill).toContain('Chrome extension');
    expect(skill).toContain(
      '**the Flaim Chrome extension for ESPN**, which is required to connect an ESPN league'
    );
    expect(skill).toContain('**Yahoo sign-in inside the Flaim UI** for Yahoo');
    expect(skill).toContain('**a Sleeper username** for Sleeper, which needs no password');
    expect(skill).toContain(
      'That is the user’s own account state, so read it with `get_user_session`'.replace(
        '’',
        "'"
      )
    );
  });

  it('locks credential and routing safety', () => {
    expect(skill).toContain('Never ask a user for a password, cookie, or token');
    expect(skill).toContain('never exposes them to the model');
    expect(skill).toContain('https://flaim.app/leagues');
    expect(skill).toContain('**flaim.app/leagues** to connect platforms');
    expect(skill).toContain("follow the MCP client's connect or reauthorization flow");
    expect(skill).toContain(
      'Do not ask the user to verify or provide numeric league IDs or season values'
    );
    expect(skill).toContain('Never expose internal platform IDs');
  });

  it('locks the data-source rule and the no-inference clauses', () => {
    expect(skill).toContain('must come from a Flaim tool call');
    expect(skill).toContain('Never guess them');
    expect(skill).toContain('a standings position is not a championship');
    expect(skill).toContain('a market ownership rate is not league ownership');
    expect(skill).toContain('a roster slot is not a draft position');
    expect(skill).toContain('First place in the standings is not a title');
    expect(skill).toContain(
      'the team that made a selection in a past draft is not necessarily the team that owns a future pick'
    );
  });

  it('locks the context-gathering backbone without restating tool mechanics', () => {
    expect(skill).toContain('Establish session context once per chat with `get_user_session`');
    expect(skill).toContain('A new chat needs its own lookup');
    expect(skill).toContain('Those identifiers do not change during a chat, so reuse them for every follow-up question');
    // "Same order every time" read as a per-message checklist and invited a
    // session call on every turn.
    expect(skill).not.toContain('Same order every time');
    expect(skill).not.toContain('when the context you need is not there');
    expect(skill).toContain(
      "use the user's applicable default for that sport and do not ask a clarifying question"
    );
    expect(skill).toContain('fan out over every matching league');
    expect(skill).toContain('call `refresh_leagues` first, then `get_user_session`');
    expect(skill).toContain('When listing the user’s leagues'.replace('’', "'"));
    expect(skill).toContain('Do not group, summarize, or truncate the list');
    expect(skill).toContain('Ground every league claim in a record the tools returned');
    expect(skill).toContain('Call `get_league_info` before the league-specific data tool');
    expect(skill).toContain('branches to `get_ancient_history`');
    expect(skill).toContain(
      'The tool descriptions and the server instructions carry the parameters, response fields, provider differences, and error handling'
    );
  });

  it('locks web research and expert consensus ahead of the model\'s own call', () => {
    expect(skill).toContain('must come from current web reporting');
    expect(skill).toContain("Never state a player's current team, role, or health from memory");
    expect(skill).toContain('Your own judgment comes after all three');
    expect(skill).toContain('needs fresh web research first');
    expect(skill).toContain('Start from expert consensus');
    expect(skill).toContain('When you depart from consensus, say so and say why');
    expect(skill).toContain('Check the date on everything');
    expect(skill).toContain('label the recommendation as based on league data alone');
    // Setup and capability answers stay tool-free and research-free.
    expect(skill).toContain('Answer them directly, without web research');
  });

  it('locks scope refusals and honesty posture', () => {
    expect(skill).toContain(
      'Do not call Flaim tools for generic coding or scraping requests, weather, travel, betting'
    );
    expect(skill).toContain('Answer general sports questions from the web with no Flaim call');
    expect(skill).toContain('do not retry in a loop');
    expect(skill).toContain('do not offer another attempt when the fix is something the user has to do first');
    expect(skill).toContain('never present a provider limitation as a fact about the league');
  });

  it('locks the category-scoring judgment rule (FLA-406)', () => {
    expect(skill).toContain(
      'the side total is the number of categories won rather than points'
    );
    expect(skill).toContain('reason category by category');
    expect(skill).toContain('Treat it as unknown, never as a zero');
  });

  it('keeps keeper cost framed as a league house rule', () => {
    expect(skill).toContain('Keeper cost is a league house rule');
    expect(skill).toContain('Flaim never computes one');
    // ESPN carries a keeper value with a traded player, so the skill must not
    // claim that no platform preserves a keeper cost after a trade.
    expect(skill).not.toMatch(/no platform computes/i);
  });

  it('does not duplicate tool mechanics that live in descriptions or instructions', () => {
    // Per-tool reference section is gone.
    expect(skill).not.toMatch(/^## Tools reference$/m);
    expect(skill).not.toMatch(/^### `get_(user_session|roster|free_agents|transactions)`$/m);

    // Field, enum, and parameter names belong in tool descriptions.
    for (const mechanic of [
      'percentOwned',
      'percentStarted',
      'ownershipScope',
      'platform_global',
      'acquisitionState',
      'waiverClearsAt',
      'FREEAGENT',
      'free_agent',
      'allLeagues',
      'defaultLeagues',
      'outcomeConfidence',
      'championshipWon',
      'selectionInRound',
      'draftColumn',
      'currentOwnerTeamId',
      'changed_picks_only',
      'keeperPlayerIds',
      'as_of_date',
      'season_year',
      'mTransactions2',
      'retry_after',
      'detail: "players"',
    ]) {
      expect(skill).not.toContain(mechanic);
    }

    // Wording prohibitions and count limits are description-level mechanics.
    expect(skill).not.toContain('Hard stop:');
    expect(skill).not.toContain('market ownership rate: not provided');
    expect(skill).not.toContain('1 through 100');

    // No version-, count-, or week-specific facts that go stale mid-season.
    expect(skill).not.toMatch(/\b(?:ten|eleven|twelve) tools\b/i);
    expect(skill).not.toMatch(/\bweek \d+\b/i);
    expect(skill).not.toMatch(/\b20\d\d\b/);
  });

  it('keeps the mechanics it removed alive on a live MCP surface', () => {
    const liveSurfaces = `${toolsSource}\n${instructions}`;

    for (const mechanic of [
      // get_free_agents ownership and wording contract
      'An ESPN-wide started rate is never conditional on the player being rostered',
      'Label every reported percentage as an ESPN-wide roster/start rate or Yahoo-wide market rate',
      'market ownership rate: not provided',
      'never specifically free agents or waivers',
      'Hard stop: after satisfying a returned-list or field-explanation request',
      'never print the ownershipScope key, platform_global enum, or get_free_agents tool name',
      // draft provenance
      'A historical selecting team is not a current pick owner',
      'changed_picks_only is not a complete pick inventory',
      // standings outcome verification
      'do not infer championship from rank or team name',
      // matchup category scoring
      'the side total is a category count or null rather than fantasy points',
      // roster snapshot selectors
      'ask the user for a specific date rather than guessing',
      // session reuse and bootstrap
      'A new chat needs its own session lookup',
      'Skip get_league_info only when answering from session data alone',
      // error posture
      'do not retry in a loop',
      'season_year is always the start year of the season',
      // provider-write boundary fallback for clients that never see the skill
      'Flaim cannot change lineups or rosters, add or drop players, submit waiver claims or trades',
      'directly and tool-free',
    ]) {
      expect(liveSurfaces).toContain(mechanic);
    }
  });
});
