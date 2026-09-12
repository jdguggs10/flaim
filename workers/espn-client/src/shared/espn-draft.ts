import { extractErrorCode } from '@flaim/worker-shared';
import type { Env, EspnDraftPick, ExecuteResponse, RoutedToolParams } from '../types';
import { getCredentials } from './auth';
import { espnFetch, handleEspnError, readEspnLeagueJson } from './espn-api';
import { getCurrentSeasonYear, getSeasonContext } from './season';
import { isEspnLeagueResponse } from '../types';

type NormalizedDraftType = 'snake' | 'linear' | 'auction' | 'offline' | 'unknown';
type NormalizedDraftStatus = 'pre_draft' | 'in_progress' | 'complete' | 'unknown';

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDraftType(value: unknown): NormalizedDraftType {
  switch (value) {
    case 'SNAKE':
      return 'snake';
    case 'AUCTION':
      return 'auction';
    case 'OFFLINE':
      return 'offline';
    default:
      return 'unknown';
  }
}

function normalizeDraftStatus(draftDetail: { drafted?: boolean; inProgress?: boolean }): NormalizedDraftStatus {
  if (draftDetail.inProgress === true) return 'in_progress';
  if (draftDetail.drafted === true) return 'complete';
  if (draftDetail.drafted === false) return 'pre_draft';
  return 'unknown';
}

function normalizePick(value: unknown, isAuction: boolean) {
  if (!isRecord(value)) return null;
  const pick = value as EspnDraftPick;
  const playerId = finiteNumber(pick.playerId);
  const round = positiveInteger(pick.roundId);

  // ESPN emits board placeholders before the draft. A populated player and a
  // usable round are the minimum evidence for a completed provider pick.
  if (playerId === undefined || round === undefined) return null;

  const selectionInRound = positiveInteger(pick.roundPickNumber);
  const overallPick = positiveInteger(pick.overallPickNumber);
  const selectionTeamId = positiveInteger(pick.teamId);
  const bidAmount = nonNegativeNumber(pick.bidAmount);

  return {
    round,
    ...(selectionInRound !== undefined ? { selectionInRound } : {}),
    ...(overallPick !== undefined ? { overallPick } : {}),
    ...(selectionTeamId !== undefined ? { selectionTeamId } : {}),
    playerId,
    ...(typeof pick.keeper === 'boolean' ? { isKeeper: pick.keeper } : {}),
    ...(isAuction && bidAmount !== undefined
      ? { cost: { amount: bidAmount, unit: 'auction_dollars' as const } }
      : {}),
    placement: {
      status: 'confirmed' as const,
      source: 'provider_pick' as const,
    },
  };
}

/**
 * Execute the shared ESPN draft-results query. ESPN uses the same
 * `mDraftDetail` envelope across sports; sport handlers supply only GAME_ID.
 */
export async function executeEspnGetDraft(
  env: Env,
  params: RoutedToolParams,
  gameId: string,
  authHeader?: string,
  correlationId?: string,
): Promise<ExecuteResponse> {
  const { league_id, sport } = params;
  const { canonicalYear, espnYear } = getSeasonContext(params);

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);
    const response = await espnFetch(
      `/seasons/${espnYear}/segments/0/leagues/${league_id}?view=mDraftDetail&view=mSettings`,
      gameId,
      {
        credentials,
        timeout: 7000,
        league: {
          leagueId: league_id,
          espnSeasonYear: espnYear,
          historical: canonicalYear < getCurrentSeasonYear(sport),
        },
      },
    );

    if (!response.ok) handleEspnError(response);

    const data = await readEspnLeagueJson(response, isEspnLeagueResponse);
    if (!data?.draftDetail) {
      return {
        success: false,
        error: 'Invalid draft data received from ESPN API',
        code: 'ESPN_INVALID_RESPONSE',
      };
    }

    const type = normalizeDraftType(data.settings?.draftSettings?.type);
    const status = normalizeDraftStatus(data.draftDetail);
    const rawPicks = Array.isArray(data.draftDetail.picks) ? data.draftDetail.picks : [];
    const picks = rawPicks
      .map((pick) => normalizePick(pick, type === 'auction'))
      .filter((pick): pick is NonNullable<typeof pick> => pick !== null);
    if (status === 'complete' && picks.length === 0) {
      return {
        success: false,
        error: 'ESPN reports a completed draft but returned no usable draft selections',
        code: 'ESPN_DRAFT_RESULTS_UNAVAILABLE',
      };
    }

    const warnings: string[] = [];
    if (status === 'pre_draft') {
      warnings.push('DRAFT_RESULTS_UNAVAILABLE: ESPN draft has not started; empty draft-board slots were omitted.');
    } else if (rawPicks.length > picks.length) {
      warnings.push(`DRAFT_PICKS_PARTIAL: ESPN returned ${rawPicks.length} draft rows, but ${rawPicks.length - picks.length} malformed or incomplete rows were omitted.`);
    } else if (picks.length === 0) {
      warnings.push(`DRAFT_RESULTS_UNAVAILABLE: ESPN returned no usable selections for draft status ${status}.`);
    }

    return {
      success: true,
      data: {
        platform: 'espn',
        sport,
        leagueId: league_id,
        seasonYear: canonicalYear,
        draft: { type, status },
        picks,
        ...(warnings.length > 0 ? { warnings } : {}),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      code: extractErrorCode(error),
    };
  }
}
