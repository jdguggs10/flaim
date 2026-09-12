import { ErrorCode } from '@flaim/worker-shared';
import { getYahooCredentials } from '../auth';
import { handleYahooError, requireCredentials, yahooFetch } from '../yahoo-api';
import {
  extractYahooDraftPlayerKeys,
  parseYahooDraftResults,
  parseYahooPlayerNames,
  type YahooDraftPick,
} from '../yahoo-draft';
import { toExecuteErrorResponse } from './utils';
import type { HandlerFn, YahooHandlerContext } from './types';

const PLAYER_NAME_BATCH_SIZE = 25;
const PLAYER_NAME_MAX_BATCHES = 24;
const PLAYER_NAME_LOOKUP_BUDGET_MS = 8_000;
const PLAYER_NAME_REQUEST_TIMEOUT_MS = 2_000;

const PLAYER_NAMES_PARTIAL_WARNING = (unresolved: number) =>
  `DRAFT_PLAYER_NAMES_PARTIAL: Yahoo did not resolve names for ${unresolved} draft pick(s); player IDs remain available.`;
const PLAYER_NAMES_UNAVAILABLE_WARNING = (unresolved: number) =>
  `DRAFT_PLAYER_NAMES_UNAVAILABLE: Yahoo player-name lookup failed; ${unresolved} draft pick name(s) remain unresolved while player IDs remain available.`;

async function jsonBeforeDeadline(response: Response, deadline: number): Promise<unknown> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Yahoo draft player-name lookup exceeded its time budget');

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response.json(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Yahoo draft player-name lookup exceeded its time budget')),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function addMissingPlayerNames(
  picks: YahooDraftPick[],
  rawDraft: unknown,
  credentials: NonNullable<Awaited<ReturnType<typeof getYahooCredentials>>>,
): Promise<{ picks: YahooDraftPick[]; warning?: string }> {
  const playerKeysById = extractYahooDraftPlayerKeys(rawDraft);
  const missingPicks = picks.filter((pick) => pick.playerId && !pick.playerName);
  if (missingPicks.length === 0) return { picks };

  const playerKeys = Array.from(new Set(
    missingPicks
      .map((pick) => playerKeysById.get(pick.playerId as string))
      .filter((key): key is string => key !== undefined),
  ));
  const namesByPlayerKey = new Map<string, string>();
  const deadline = Date.now() + PLAYER_NAME_LOOKUP_BUDGET_MS;
  let lookupFailed = false;

  for (
    let offset = 0, batch = 0;
    offset < playerKeys.length && batch < PLAYER_NAME_MAX_BATCHES;
    offset += PLAYER_NAME_BATCH_SIZE, batch += 1
  ) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      lookupFailed = true;
      break;
    }

    const keys = playerKeys.slice(offset, offset + PLAYER_NAME_BATCH_SIZE);
    try {
      const path = `/players;player_keys=${keys.map(encodeURIComponent).join(',')}`;
      const response = await yahooFetch(path, {
        credentials,
        timeout: Math.max(1, Math.min(PLAYER_NAME_REQUEST_TIMEOUT_MS, remaining)),
      });
      // This enrichment is best-effort. Do not consume an error body or retry:
      // stop immediately and return the confirmed picks with a warning.
      if (!response.ok) throw new Error(`Yahoo player-name lookup returned ${response.status}`);

      const parsed = parseYahooPlayerNames(await jsonBeforeDeadline(response, deadline));
      if (!parsed.valid) {
        lookupFailed = true;
        break;
      }

      // Only accept exact full-key matches from this batch. Numeric IDs alone
      // can identify a different player record in another sport or season.
      for (const key of keys) {
        const name = parsed.byPlayerKey.get(key);
        if (name) namesByPlayerKey.set(key, name);
      }
    } catch (error) {
      lookupFailed = true;
      console.warn(JSON.stringify({
        event: 'yahoo_draft_player_names',
        status: 'unavailable',
        error: error instanceof Error ? error.message : String(error),
      }));
      break;
    }
  }

  const enrichedPicks = picks.map((pick) => {
    if (!pick.playerId || pick.playerName) return pick;
    const playerKey = playerKeysById.get(pick.playerId);
    const playerName = playerKey ? namesByPlayerKey.get(playerKey) : undefined;
    return playerName ? { ...pick, playerName } : pick;
  });
  const unresolved = enrichedPicks.filter((pick) => pick.playerId && !pick.playerName).length;

  return {
    picks: enrichedPicks,
    ...(unresolved > 0
      ? { warning: lookupFailed ? PLAYER_NAMES_UNAVAILABLE_WARNING(unresolved) : PLAYER_NAMES_PARTIAL_WARNING(unresolved) }
      : {}),
  };
}

export function createGetDraftHandler(_config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { league_id: leagueId, season_year: seasonYear, sport } = params;
    if (!leagueId) {
      return {
        success: false,
        error: 'league_id is required for get_draft',
        code: ErrorCode.MISSING_PARAM,
      };
    }

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_draft');

      const response = await yahooFetch(`/league/${leagueId}/draftresults`, { credentials });
      if (!response.ok) await handleYahooError(response);

      const rawDraft = await response.json();
      const parsed = parseYahooDraftResults(rawDraft);
      if (!parsed) {
        return {
          success: false,
          error: 'Yahoo returned an invalid draft-results payload',
          code: 'YAHOO_INVALID_DRAFT_RESULTS',
        };
      }
      if (parsed.draft.status === 'complete' && parsed.picks.length === 0) {
        return {
          success: false,
          error: 'Yahoo reports a completed draft but returned no usable draft selections',
          code: 'YAHOO_DRAFT_RESULTS_UNAVAILABLE',
        };
      }

      const enriched = await addMissingPlayerNames(parsed.picks, rawDraft, credentials);
      const warnings = [
        ...(parsed.warnings ?? []),
        ...(enriched.warning ? [enriched.warning] : []),
      ];

      return {
        success: true,
        data: {
          platform: 'yahoo',
          sport,
          leagueId,
          seasonYear,
          draft: parsed.draft,
          picks: enriched.picks,
          ...(warnings.length > 0 ? { warnings } : {}),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
