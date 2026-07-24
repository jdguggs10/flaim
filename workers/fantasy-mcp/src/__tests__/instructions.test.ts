import { describe, expect, it } from 'vitest';
import { FLAIM_MCP_INSTRUCTIONS } from '../mcp/instructions';

describe('Flaim MCP initialization instructions', () => {
  it('puts the complete provider-write boundary and tool-free capability path first', () => {
    const opening = FLAIM_MCP_INSTRUCTIONS.split('\n\n', 1)[0];
    const first512 = FLAIM_MCP_INSTRUCTIONS.slice(0, 512);

    expect(opening.length).toBeLessThanOrEqual(512);
    expect(first512).toContain('refresh_leagues is its only bounded write');
    expect(first512).toContain('never ESPN, Yahoo, or Sleeper state');
    expect(first512).toContain('cannot change lineups or rosters');
    expect(first512).toContain('submit waiver claims or trades');
    expect(first512).toContain('even with permission');
    expect(first512).toContain('capability, permission, or generic setup how-to questions');
    expect(first512).toContain('directly and tool-free');
    expect(first512).toContain('do not call get_user_session or another tool');
  });

  it('keeps refresh and normal league-analysis paths distinct', () => {
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'Capability, permission, or generic setup how-to question: answer tool-free'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'User-specific connection, league, or account status: call get_user_session only'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'Explicit refresh request or widget refresh: call refresh_leagues, then call get_user_session after success'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'Selected-league analysis: call get_user_session once before any other data tool. Then call get_league_info, then the requested league-specific data tool'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'After a later successful refresh, call get_user_session again'
    );
  });

  it('keeps weather and generic coding or scraping outside Flaim tools', () => {
    expect(FLAIM_MCP_INSTRUCTIONS).toContain('generic sports news, coding, scraping, weather');
    expect(FLAIM_MCP_INSTRUCTIONS).toContain('Do not call Flaim tools');
  });

  it('keeps free-agent availability, ownership, and professional-team scopes distinct', () => {
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'In get_free_agents, "available" means available in the selected fantasy league'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'ESPN percentOwned/percentStarted are the percentages of all ESPN leagues where the player is rostered/started'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain('Yahoo percentOwned is Yahoo-wide');
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'Label every reported percentage as an ESPN-wide roster/start rate or Yahoo-wide market rate'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'If a rate is missing, write "[Provider] market ownership rate: not provided"; do not repeat response field names/nulls, call get_players, or offer a lookup'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'Only ESPN reports acquisition state here'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'call Yahoo/Sleeper rows "available players," never specifically free agents or waivers'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'Translate ESPN status codes silently; never print raw codes such as FREEAGENT or WAIVERS'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'For a returned list or field explanation, end after the requested facts; never add an "if you want" offer or qualitative advice'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'Use get_roster for a separate ownership question'
    );
  });

  it('allows one bounded retry only for temporary failures', () => {
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'Correct invalid-request parameters before trying again'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      "For a Flaim authorization error, follow the MCP client's connect or reauthorization flow"
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'For a missing or invalid provider connection, provider credentials, or league record'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'do not offer another attempt until the user confirms the problem is corrected'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain(
      'For a network timeout or explicitly temporary provider/Flaim service failure, one retry with the same inputs is reasonable'
    );
    expect(FLAIM_MCP_INSTRUCTIONS).toContain('unless retry_after says to wait');
    expect(FLAIM_MCP_INSTRUCTIONS).toContain('do not loop');
    expect(FLAIM_MCP_INSTRUCTIONS).toContain('https://flaim.app/leagues');
  });

  it('does not claim that every Flaim operation is read-only', () => {
    expect(FLAIM_MCP_INSTRUCTIONS).not.toContain('Flaim provides read-only');
    expect(FLAIM_MCP_INSTRUCTIONS).not.toContain('Flaim is strictly read-only');
  });
});
