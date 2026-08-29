import { asArray, getPath, toYahooFiniteNumber, unwrapLeague } from './normalizers';

type DraftType = 'snake' | 'linear' | 'auction' | 'offline' | 'unknown';
type DraftStatus = 'pre_draft' | 'in_progress' | 'complete' | 'unknown';

export interface YahooDraftPick {
  round: number;
  selectionInRound?: number;
  overallPick?: number;
  selectionTeamId: string;
  playerId?: string;
  playerName?: string;
  cost?: {
    amount: number;
    unit: 'auction_dollars';
  };
  placement: {
    status: 'confirmed';
    source: 'provider_pick';
  };
}

export interface YahooDraftResults {
  draft: {
    type: DraftType;
    status: DraftStatus;
  };
  picks: YahooDraftPick[];
  warnings?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = toYahooFiniteNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const parsed = toYahooFiniteNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeDraftType(value: unknown): DraftType {
  switch (typeof value === 'string' ? value.trim().toLowerCase() : undefined) {
    case 'snake':
      return 'snake';
    case 'linear':
      return 'linear';
    case 'auction':
      return 'auction';
    case 'offline':
      return 'offline';
    // Yahoo's common "live" value does not distinguish snake from auction.
    default:
      return 'unknown';
  }
}

function normalizeDraftStatus(value: unknown): DraftStatus {
  switch (typeof value === 'string' ? value.trim().toLowerCase() : undefined) {
    case 'predraft':
    case 'pre_draft':
      return 'pre_draft';
    case 'drafting':
    case 'in_progress':
      return 'in_progress';
    case 'postdraft':
    case 'complete':
      return 'complete';
    default:
      return 'unknown';
  }
}

function draftResultRecord(wrapper: unknown): Record<string, unknown> | undefined {
  if (!isRecord(wrapper)) return undefined;
  return isRecord(wrapper.draft_result) ? wrapper.draft_result : undefined;
}

function playerName(result: Record<string, unknown>): string | undefined {
  const direct = nonEmptyString(result.player_name) ?? nonEmptyString(result.full_name);
  if (direct) return direct;

  const name = result.name;
  if (isRecord(name)) return nonEmptyString(name.full);
  return nonEmptyString(name);
}

/**
 * Parse Yahoo's `/league/{key}/draftresults` response. Draft-result rows are
 * historical facts: `team_key` is the team that made the selection, not the
 * player's present-day roster owner. The resource does not expose pick
 * ownership, so this parser intentionally never derives it from another API.
 */
export function parseYahooDraftResults(raw: unknown): YahooDraftResults | undefined {
  const leagueArray = getPath(raw, ['fantasy_content', 'league']);
  const league = unwrapLeague(leagueArray);
  const rawResults = league.draft_results;

  // A missing resource is malformed. A present numeric-keyed object with only
  // `count: 0` is a valid pre-draft/empty response and parses to no picks.
  if (!Array.isArray(rawResults) && !isRecord(rawResults)) return undefined;

  const type = normalizeDraftType(league.draft_type);
  const rawRows = asArray(rawResults as Record<string, unknown> | unknown[]);
  const declaredCount = isRecord(rawResults) ? nonNegativeInteger(rawResults.count) : undefined;
  const picks = rawRows
    .map(draftResultRecord)
    .filter((result): result is Record<string, unknown> => result !== undefined)
    .map((result): YahooDraftPick | undefined => {
      const round = positiveInteger(result.round);
      const selectionTeamId = nonEmptyString(result.team_key) ?? nonEmptyString(result.team_id);
      // Yahoo documents player_key on draft-result rows. Keep it as the
      // provider player identifier when a separate player_id is absent.
      const playerId = nonEmptyString(result.player_id) ?? nonEmptyString(result.player_key);
      const name = playerName(result);

      // A drafted player, a valid round, and the selecting team are the
      // minimum evidence for an actual provider pick. This drops placeholders
      // and malformed rows instead of presenting them as confirmed history.
      if (!round || !selectionTeamId || (!playerId && !name)) return undefined;

      // Yahoo's documented draft-result `pick` field is only described as a
      // "draft pick number". Without authoritative evidence that it is the
      // overall draft position (rather than another pick coordinate), leave it
      // out instead of asserting an incorrect cross-provider meaning.
      const selectionInRound = positiveInteger(result.selection_in_round) ?? positiveInteger(result.pick_in_round);
      const cost = toYahooFiniteNumber(result.cost);

      return {
        round,
        ...(selectionInRound !== undefined ? { selectionInRound } : {}),
        selectionTeamId,
        ...(playerId ? { playerId } : {}),
        ...(name ? { playerName: name } : {}),
        ...(type === 'auction' && cost !== undefined
          ? { cost: { amount: cost, unit: 'auction_dollars' as const } }
          : {}),
        placement: { status: 'confirmed', source: 'provider_pick' },
      };
    })
    .filter((pick): pick is YahooDraftPick => pick !== undefined);

  const reportedRows = Math.max(rawRows.length, declaredCount ?? 0);
  const omittedRows = reportedRows - picks.length;
  return {
    draft: {
      type,
      status: normalizeDraftStatus(league.draft_status),
    },
    picks,
    ...(omittedRows > 0
      ? { warnings: [`DRAFT_PICKS_PARTIAL: Yahoo reported ${reportedRows} draft rows, but ${omittedRows} were missing, malformed, or incomplete.`] }
      : {}),
  };
}
