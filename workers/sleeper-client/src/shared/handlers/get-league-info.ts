import type { HandlerFn } from './types';
import type { SleeperLeague, SleeperLeagueUser, SleeperRoster, SleeperTradedPick } from '../../types';
import { ErrorCode } from '@flaim/worker-shared';
import { sleeperFetch, handleSleeperError } from '../sleeper-api';
import { toExecuteErrorResponse } from './utils';
import { buildUserDirectory, type SleeperUserDirectoryEntry } from '../sleeper-enrichment';

export const TRADED_PICKS_UNAVAILABLE_WARNING =
  'TRADED_PICKS_UNAVAILABLE: Sleeper traded-pick data unavailable; draft-pick ownership omitted for this league.';

const PICK_OWNERSHIP_NOTE =
  'Each roster owns its own picks for every season/round unless listed here; use draftRounds for future drafts.';

interface ResolvedTradedPick {
  season: string;
  round: number;
  originalRosterId: number;
  originalOwnerName?: string;
  originalTeamName?: string;
  previousRosterId: number;
  currentRosterId: number;
  currentOwnerName?: string;
  currentTeamName?: string;
}

/**
 * Resolves raw Sleeper traded-pick entries into named ownership records and
 * sorts them (season, round, originalRosterId asc) for stable output.
 * roster_id is the pick's ORIGINAL owner roster, owner_id is its CURRENT
 * owner roster; both are resolved to names via roster.owner_id ->
 * buildUserDirectory. previousRosterId is passed through as a raw roster id
 * — no name resolution is required for it.
 */
function resolveTradedPicks(
  picks: SleeperTradedPick[],
  rosterOwnerById: Map<number, string>,
  userDirectory: Map<string, SleeperUserDirectoryEntry>,
): ResolvedTradedPick[] {
  const resolveNames = (rosterId: number): { ownerName?: string; teamName?: string } => {
    const userId = rosterOwnerById.get(rosterId);
    const entry = userId ? userDirectory.get(userId) : undefined;
    return { ownerName: entry?.displayName || undefined, teamName: entry?.teamName };
  };

  return picks
    .map((pick) => {
      const original = resolveNames(pick.roster_id);
      const current = resolveNames(pick.owner_id);
      return {
        season: pick.season,
        round: pick.round,
        originalRosterId: pick.roster_id,
        originalOwnerName: original.ownerName,
        originalTeamName: original.teamName,
        previousRosterId: pick.previous_owner_id,
        currentRosterId: pick.owner_id,
        currentOwnerName: current.ownerName,
        currentTeamName: current.teamName,
      };
    })
    .sort((a, b) => {
      if (a.season !== b.season) return a.season.localeCompare(b.season);
      if (a.round !== b.round) return a.round - b.round;
      return a.originalRosterId - b.originalRosterId;
    });
}

export function createGetLeagueInfoHandler(): HandlerFn {
  return async (_env, params) => {
    const { league_id } = params;
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_league_info', code: ErrorCode.MISSING_PARAM };
    }

    try {
      // traded_picks is fetched alongside the other three, but its own
      // network-level failure (timeout/abort) must not fail the whole
      // request the way a league/rosters/users failure does — it degrades
      // to a warning instead, so its rejection is caught locally and
      // resolved to null rather than propagating into Promise.all.
      const [leagueRes, rostersRes, usersRes, tradedPicksRes] = await Promise.all([
        sleeperFetch(`/league/${league_id}`),
        sleeperFetch(`/league/${league_id}/rosters`),
        sleeperFetch(`/league/${league_id}/users`),
        sleeperFetch(`/league/${league_id}/traded_picks`).catch((error) => {
          console.error(`[get-league-info] traded_picks fetch threw for league ${league_id}:`, error);
          return null;
        }),
      ]);

      if (!leagueRes.ok) handleSleeperError(leagueRes);
      if (!rostersRes.ok) handleSleeperError(rostersRes);
      if (!usersRes.ok) handleSleeperError(usersRes);

      const league: SleeperLeague = await leagueRes.json();
      const rosters: SleeperRoster[] = await rostersRes.json();
      const users: SleeperLeagueUser[] = await usersRes.json();

      const userDirectory = buildUserDirectory(users);
      const rosterOwnerById = new Map<number, string>(rosters.map((roster) => [roster.roster_id, roster.owner_id]));

      const teams = rosters.map((roster) => {
        const entry = userDirectory.get(roster.owner_id);
        return {
          rosterId: roster.roster_id,
          ownerId: roster.owner_id,
          ownerName: entry?.displayName || undefined,
          teamName: entry?.teamName,
        };
      });

      // Traded picks degrade independently of the rest of the response: a
      // failed or malformed fetch omits tradedPicks and adds a warning
      // rather than failing the whole get_league_info call, matching the
      // FLA-275 player-enrichment degradation pattern.
      const warnings: string[] = [];
      let tradedPicks: ResolvedTradedPick[] | undefined;

      if (tradedPicksRes && tradedPicksRes.ok) {
        let tradedPicksRaw: unknown;
        try {
          tradedPicksRaw = await tradedPicksRes.json();
        } catch (error) {
          console.error(`[get-league-info] Failed to parse traded_picks response for league ${league_id}:`, error);
          tradedPicksRaw = undefined;
        }

        if (Array.isArray(tradedPicksRaw)) {
          tradedPicks = resolveTradedPicks(tradedPicksRaw as SleeperTradedPick[], rosterOwnerById, userDirectory);
        } else {
          console.error(`[get-league-info] traded_picks response for league ${league_id} was not an array`);
          warnings.push(TRADED_PICKS_UNAVAILABLE_WARNING);
        }
      } else {
        if (tradedPicksRes) {
          console.error(`[get-league-info] traded_picks fetch failed for league ${league_id} (status ${tradedPicksRes.status})`);
        }
        warnings.push(TRADED_PICKS_UNAVAILABLE_WARNING);
      }

      const draftRounds = typeof league.settings?.draft_rounds === 'number' ? league.settings.draft_rounds : undefined;

      return {
        success: true,
        data: {
          leagueId: league.league_id,
          name: league.name,
          sport: league.sport,
          season: league.season,
          status: league.status,
          totalRosters: league.total_rosters,
          rosterPositions: league.roster_positions,
          scoringSettings: league.scoring_settings,
          previousLeagueId: league.previous_league_id,
          draftId: league.draft_id,
          teams,
          draftRounds,
          ...(tradedPicks ? { tradedPicks, pickOwnershipNote: PICK_OWNERSHIP_NOTE } : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
