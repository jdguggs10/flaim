import { describe, expect, it } from 'vitest';
import { parseYahooDraftResults } from '../yahoo-draft';

function responseWith(rows: Record<string, unknown>, metadata: Record<string, unknown> = {}): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.123', draft_status: 'postdraft', draft_type: 'live', ...metadata },
        { draft_results: rows },
      ],
    },
  };
}

describe('parseYahooDraftResults', () => {
  it('uses Yahoo draft-result team_key as the historical selecting team', () => {
    const parsed = parseYahooDraftResults(responseWith({
      '0': {
        draft_result: {
          pick: '13',
          round: '2',
          team_key: '449.l.123.t.7',
          player_key: '449.p.501',
          player_name: 'Historic Pick',
          cost: '17',
        },
      },
      count: 1,
    }));

    expect(parsed).toEqual({
      draft: { type: 'unknown', status: 'complete' },
      picks: [{
        round: 2,
        selectionTeamId: '449.l.123.t.7',
        playerId: '449.p.501',
        playerName: 'Historic Pick',
        placement: { status: 'confirmed', source: 'provider_pick' },
      }],
    });
    expect(parsed?.picks[0]).not.toHaveProperty('currentTeamId');
    expect(parsed?.picks[0]).not.toHaveProperty('ownership');
  });

  it('omits malformed rows while preserving supplied optional placement fields', () => {
    const parsed = parseYahooDraftResults(responseWith({
      '0': { draft_result: { pick: '1', round: '1', team_key: '449.l.123.t.1', player_key: '449.p.101' } },
      '1': { draft_result: { pick: '2', round: 'not-a-round', team_key: '449.l.123.t.2', player_key: '449.p.102' } },
      '2': { draft_result: { pick: '3', round: '1', team_key: '', player_key: '449.p.103' } },
      '3': { draft_result: { pick: '4', round: '1', team_key: '449.l.123.t.4' } },
      '4': { draft_result: { pick: '5', round: '1', team_key: '449.l.123.t.5', player_key: '449.p.105', selection_in_round: '5', cost: '17' } },
      count: 5,
    }, { draft_status: 'drafting', draft_type: 'auction' }));

    expect(parsed).toEqual({
      draft: { type: 'auction', status: 'in_progress' },
      picks: [
        {
          round: 1,
          selectionTeamId: '449.l.123.t.1',
          playerId: '449.p.101',
          placement: { status: 'confirmed', source: 'provider_pick' },
        },
        {
          round: 1,
          selectionInRound: 5,
          selectionTeamId: '449.l.123.t.5',
          playerId: '449.p.105',
          cost: { amount: 17, unit: 'auction_dollars' },
          placement: { status: 'confirmed', source: 'provider_pick' },
        },
      ],
      warnings: ['DRAFT_PICKS_PARTIAL: Yahoo reported 5 draft rows, but 3 were missing, malformed, or incomplete.'],
    });
  });

  it('warns when Yahoo declares more completed rows than it physically returns', () => {
    const parsed = parseYahooDraftResults(responseWith({
      '0': {
        draft_result: {
          round: '1',
          team_key: '449.l.123.t.1',
          player_key: '449.p.101',
        },
      },
      count: 12,
    }));

    expect(parsed).toMatchObject({
      draft: { status: 'complete' },
      picks: [expect.objectContaining({ playerId: '449.p.101' })],
      warnings: ['DRAFT_PICKS_PARTIAL: Yahoo reported 12 draft rows, but 11 were missing, malformed, or incomplete.'],
    });
  });

  it('accepts a legitimate empty draft-results collection but rejects a missing resource', () => {
    expect(parseYahooDraftResults(responseWith({ count: 0 }, { draft_status: 'predraft' }))).toEqual({
      draft: { type: 'unknown', status: 'pre_draft' },
      picks: [],
    });
    expect(parseYahooDraftResults({ fantasy_content: { league: [{ draft_status: 'predraft' }, {}] } })).toBeUndefined();
  });
});
