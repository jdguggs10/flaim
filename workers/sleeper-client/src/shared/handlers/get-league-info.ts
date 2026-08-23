import type { HandlerFn } from './types';
import type { SleeperLeague, SleeperLeagueSettings, SleeperLeagueUser, SleeperRoster, SleeperTradedPick } from '../../types';
import { ErrorCode } from '@flaim/worker-shared';
import { sleeperFetch, handleSleeperError } from '../sleeper-api';
import { toExecuteErrorResponse } from './utils';
import { buildUserDirectory, type SleeperUserDirectoryEntry } from '../sleeper-enrichment';

export const TRADED_PICKS_UNAVAILABLE_WARNING =
  'TRADED_PICKS_UNAVAILABLE: Sleeper traded-pick data unavailable; draft-pick ownership omitted for this league.';

export function tradedPicksPartialWarning(dropped: number): string {
  return `TRADED_PICKS_PARTIAL: the traded-pick list may be incomplete; ${dropped} malformed ${dropped === 1 ? 'entry was' : 'entries were'} dropped.`;
}

const PICK_OWNERSHIP_NOTE =
  'Only picks that changed hands are listed; every roster owns its own untraded picks. Sleeper allows pick trading for ' +
  'the current season plus up to three future seasons depending on league settings — treat seasons beyond those listed ' +
  'as unverified. Use draftRounds for rounds per future draft.';

const LEAGUE_FORMAT_TYPE_NOTE =
  'Undocumented Sleeper convention: 0/1/2 are commonly redraft/keeper/dynasty; 3 observed as guillotine. Do not rely on it alone.';

interface LeagueFormatTaxi {
  slots?: number;
  years?: number;
  allowVets?: boolean;
  deadline?: number;
}

interface LeagueFormat {
  typeRaw: number | null;
  typeNote: string;
  maxKeepers?: number;
  tradeDeadlineWeek?: number;
  tradesDisabled?: boolean;
  pickTrading?: boolean;
  taxi?: LeagueFormatTaxi;
  reserveSlots?: number;
}

/**
 * Sleeper encodes several league-settings booleans as numeric 0/1 (rather
 * than JSON `true`/`false`), and does not document what other values —
 * missing, `null`, or something other than 0/1 — mean. Treating "missing"
 * or "invalid" as `false` would assert a specific disabled/off state that
 * Sleeper never actually reported (FLA-284 audit). Only exactly numeric `0`
 * or `1` is trusted; anything else resolves to `undefined` so the caller
 * omits the field instead of guessing.
 */
function sleeperNumericFlag(value: unknown): boolean | undefined {
  if (value === 1) return true;
  if (value === 0) return false;
  return undefined;
}

/**
 * Builds get_league_info's leagueFormat block from the league's raw
 * `settings`. Returns undefined when settings itself is absent (nothing to
 * report); once settings exists, leagueFormat is always included even if
 * every keeper/taxi-specific field within it is unset — typeRaw falls back
 * to null, while tradesDisabled/pickTrading/taxi.allowVets are omitted
 * (rather than defaulted to false) whenever Sleeper doesn't send an exact
 * numeric 0/1 for them.
 */
function buildLeagueFormat(settings: SleeperLeagueSettings | undefined): LeagueFormat | undefined {
  if (!settings) return undefined;

  const allowVets = sleeperNumericFlag(settings.taxi_allow_vets);
  const taxi: LeagueFormatTaxi = {
    ...(typeof settings.taxi_slots === 'number' ? { slots: settings.taxi_slots } : {}),
    ...(typeof settings.taxi_years === 'number' ? { years: settings.taxi_years } : {}),
    ...(allowVets !== undefined ? { allowVets } : {}),
    ...(typeof settings.taxi_deadline === 'number' ? { deadline: settings.taxi_deadline } : {}),
  };

  const tradesDisabled = sleeperNumericFlag(settings.disable_trades);
  const pickTrading = sleeperNumericFlag(settings.pick_trading);

  return {
    typeRaw: typeof settings.type === 'number' ? settings.type : null,
    typeNote: LEAGUE_FORMAT_TYPE_NOTE,
    ...(typeof settings.max_keepers === 'number' ? { maxKeepers: settings.max_keepers } : {}),
    ...(typeof settings.trade_deadline === 'number' ? { tradeDeadlineWeek: settings.trade_deadline } : {}),
    ...(tradesDisabled !== undefined ? { tradesDisabled } : {}),
    ...(pickTrading !== undefined ? { pickTrading } : {}),
    ...(Object.keys(taxi).length > 0 ? { taxi } : {}),
    ...(typeof settings.reserve_slots === 'number' ? { reserveSlots: settings.reserve_slots } : {}),
  };
}

/**
 * Runtime-validates one raw traded_picks entry before it is trusted. Sleeper
 * is a public, undocumented API — a null entry, a numeric/missing season, or
 * a non-integer roster id must never reach resolveTradedPicks (which would
 * throw, e.g. from localeCompare on a non-string season) and must never
 * escape the handler's outer try/catch as a full-request failure.
 */
function isValidTradedPick(value: unknown): value is SleeperTradedPick {
  if (typeof value !== 'object' || value === null) return false;
  const pick = value as Record<string, unknown>;
  return (
    typeof pick.season === 'string' &&
    pick.season.trim().length > 0 &&
    Number.isInteger(pick.round) &&
    (pick.round as number) >= 1 &&
    Number.isInteger(pick.roster_id) &&
    Number.isInteger(pick.previous_owner_id) &&
    Number.isInteger(pick.owner_id)
  );
}

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
          // Raw player_id[] — name resolution is deferred (see FLA-284 plan
          // decision #3): this handler doesn't otherwise load the KV-backed
          // player index, and no live example of a populated keepers[] has
          // been observed yet to justify the extra fetch. null vs [] is
          // preserved exactly as Sleeper sends it (both observed live).
          keepers: roster.keepers,
        };
      });

      // Traded picks degrade independently of the rest of the response: a
      // failed fetch or an unusable body omits tradedPicks and adds a warning
      // rather than failing the whole get_league_info call, matching the
      // FLA-275 player-enrichment degradation pattern. Individual malformed
      // entries are dropped (with a count warning) rather than discarding the
      // valid ones — dynasty users are the audience, and one odd entry from a
      // public, undocumented API should not hide every legitimate trade.
      const warnings: string[] = [];
      let tradedPicks: ResolvedTradedPick[] | undefined;

      if (tradedPicksRes && tradedPicksRes.ok) {
        let tradedPicksRaw: unknown;
        let parseFailed = false;
        try {
          tradedPicksRaw = await tradedPicksRes.json();
        } catch (error) {
          console.error(`[get-league-info] Failed to parse traded_picks response for league ${league_id}:`, error);
          parseFailed = true;
        }

        if (!parseFailed && Array.isArray(tradedPicksRaw)) {
          const validPicks = tradedPicksRaw.filter(isValidTradedPick);
          const dropped = tradedPicksRaw.length - validPicks.length;
          if (dropped > 0 && validPicks.length === 0) {
            console.error(`[get-league-info] traded_picks response for league ${league_id} contained no valid entries (${dropped} malformed)`);
            warnings.push(TRADED_PICKS_UNAVAILABLE_WARNING);
          } else {
            if (dropped > 0) {
              console.error(`[get-league-info] traded_picks response for league ${league_id} dropped ${dropped} malformed entries`);
              warnings.push(tradedPicksPartialWarning(dropped));
            }
            tradedPicks = resolveTradedPicks(validPicks, rosterOwnerById, userDirectory);
          }
        } else {
          if (!parseFailed) {
            console.error(`[get-league-info] traded_picks response for league ${league_id} was not an array`);
          }
          warnings.push(TRADED_PICKS_UNAVAILABLE_WARNING);
        }
      } else {
        if (tradedPicksRes) {
          console.error(`[get-league-info] traded_picks fetch failed for league ${league_id} (status ${tradedPicksRes.status})`);
        }
        warnings.push(TRADED_PICKS_UNAVAILABLE_WARNING);
      }

      const draftRounds = typeof league.settings?.draft_rounds === 'number' ? league.settings.draft_rounds : undefined;
      const leagueFormat = buildLeagueFormat(league.settings);

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
          ...(leagueFormat ? { leagueFormat } : {}),
          teams,
          draftRounds,
          // pickOwnershipNote is suppressed when tradedPicks is empty — an
          // empty list just means redraft or no trades, and the note's
          // horizon caveat is only useful once there's something to caveat.
          ...(tradedPicks
            ? { tradedPicks, ...(tradedPicks.length > 0 ? { pickOwnershipNote: PICK_OWNERSHIP_NOTE } : {}) }
            : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
