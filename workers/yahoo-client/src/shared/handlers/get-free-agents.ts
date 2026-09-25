import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, unwrapLeague } from '../normalizers';
import { ErrorCode } from '@flaim/worker-shared';
import {
  PLAYER_SUB_RESOURCES,
  extractPlayerMeta,
  extractPlayerPercentOwned,
  normalizeIsKeeper,
  toExecuteErrorResponse,
  type YahooKeeperStatus,
} from './utils';

// Yahoo silently clamps the `players` collection to 25 entries per response
// no matter what larger `;count=` is requested (FLA-9), so this is only a
// request hint. The loop below advances `start` by what Yahoo actually
// returns and never assumes this value is honored.
const YAHOO_PLAYERS_PAGE_SIZE = 25;

// Safety bound so a misbehaving upstream can't loop forever. Reaching
// `limit` (max 100) needs 4 pages at the real 25/page cap; this gives 5x
// slack for pages shorter than 25 without letting a broken upstream loop
// forever. Tripping this returns whatever was collected instead of erroring.
const MAX_FREE_AGENT_PAGES = 20;

type YahooFreeAgent = {
  playerKey: string;
  playerId: string;
  name: string;
  team: string;
  position: string;
  percentOwned: number | null;
  status: string | undefined;
  isKeeper?: YahooKeeperStatus;
};

/**
 * Rate desc, rate-less entries last. Two rate-less entries compare equal so
 * the (stable) sort leaves them in Yahoo's returned `sort=OR` overall-rank
 * order: falling through to a name tiebreak here would silently re-rank a
 * whole rate-less response into alphabetical order.
 */
function compareFreeAgents(a: YahooFreeAgent, b: YahooFreeAgent): number {
  const aOwned = a.percentOwned;
  const bOwned = b.percentOwned;

  if (aOwned == null && bOwned == null) return 0;
  if (aOwned == null) return 1;
  if (bOwned == null) return -1;
  if (aOwned !== bOwned) return bOwned - aOwned;

  const nameCompare = a.name.localeCompare(b.name);
  if (nameCompare !== 0) return nameCompare;

  return a.playerId.localeCompare(b.playerId);
}

export function createGetFreeAgentsHandler(config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { league_id, position, count } = params;

    if (!league_id) {
      return {
        success: false,
        error: 'league_id is required for get_free_agents',
        code: ErrorCode.MISSING_PARAM,
      };
    }

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_free_agents');

      const limit = Math.min(Math.max(1, count || 25), 100);
      const positionKey = position?.toUpperCase() || 'ALL';
      const posFilter = config.getPositionFilter(position);
      const allFreeAgents: YahooFreeAgent[] = [];
      // Yahoo's start/count paging isn't guaranteed stable across requests —
      // a player's availability can change between page fetches, so pages
      // can overlap and the same player key can be appended twice.
      const seenPlayerKeys = new Set<string>();

      // Captured from the first page that provides it. A terminal empty
      // page's response can omit league metadata entirely, and letting a
      // later page overwrite these would lose the real values.
      let leagueKey: unknown;
      let leagueName: unknown;
      let start = 0;

      for (let page = 0; page < MAX_FREE_AGENT_PAGES; page++) {
        let queryParams = `;status=A;count=${YAHOO_PLAYERS_PAGE_SIZE};sort=OR;start=${start}`;
        if (posFilter) {
          queryParams += `;position=${posFilter}`;
        }
        // `;out=` is the only form that returns percent_owned alongside
        // ownership; a trailing /ownership path yields league owner state only.
        queryParams += `;out=${PLAYER_SUB_RESOURCES}`;

        const response = await yahooFetch(`/league/${league_id}/players${queryParams}`, { credentials });
        if (!response.ok) {
          await handleYahooError(response);
        }

        const raw = await response.json();
        const leagueArray = getPath(raw, ['fantasy_content', 'league']);
        const pageLeague = unwrapLeague(leagueArray);
        if (leagueKey === undefined && pageLeague.league_key !== undefined) {
          leagueKey = pageLeague.league_key;
        }
        if (leagueName === undefined && pageLeague.name !== undefined) {
          leagueName = pageLeague.name;
        }
        const playersObj = pageLeague.players as Record<string, unknown> | undefined;
        const playersArray = asArray(playersObj);

        // An empty page is the only reliable end-of-collection signal — a
        // short-but-non-empty page is not (that assumption caused FLA-9).
        if (playersArray.length === 0) {
          break;
        }

        for (const playerWrapper of playersArray) {
          const playerData = getPath(playerWrapper, ['player']) as unknown[];
          const playerMeta = extractPlayerMeta(playerData);
          // See get-roster.ts for why isKeeper isn't gated on any
          // historical/snapshot logic — free agents have no such concept.
          const isKeeper = normalizeIsKeeper(playerMeta.is_keeper);

          const playerKey = playerMeta.player_key as string;
          const playerId = playerMeta.player_id as string;
          // Dedupe before the limit check below, so limit counts unique
          // players — otherwise an overlap-duplicated entry consumes a
          // caller's limit slot and pushes out a unique player.
          const dedupeKey = playerKey || playerId;
          if (dedupeKey && seenPlayerKeys.has(dedupeKey)) {
            continue;
          }
          if (dedupeKey) {
            seenPlayerKeys.add(dedupeKey);
          }

          allFreeAgents.push({
            playerKey,
            playerId,
            name: (playerMeta.name as Record<string, unknown>)?.full as string,
            team: playerMeta.editorial_team_abbr as string,
            position: playerMeta.display_position as string,
            percentOwned: extractPlayerPercentOwned(playerData),
            status: playerMeta.status as string | undefined,
            ...(isKeeper ? { isKeeper } : {}),
          });
        }

        start += playersArray.length;

        if (allFreeAgents.length >= limit) {
          break;
        }
      }

      const freeAgents = allFreeAgents.sort(compareFreeAgents).slice(0, limit);

      return {
        success: true,
        data: {
          leagueKey,
          leagueName,
          position: positionKey,
          count: freeAgents.length,
          freeAgents,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
