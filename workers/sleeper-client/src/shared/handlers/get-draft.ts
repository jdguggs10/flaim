import type {
  SleeperDraft,
  SleeperDraftPick,
  SleeperLeague,
  SleeperLeagueUser,
  SleeperRoster,
  SleeperTradedPick,
} from '../../types';
import type { HandlerFn, SleeperSportConfig } from './types';
import { ErrorCode } from '@flaim/worker-shared';
import { handleSleeperError, sleeperFetch } from '../sleeper-api';
import { buildUserDirectory } from '../sleeper-enrichment';
import { toExecuteErrorResponse } from './utils';

const DRAFT_TEAMS_UNAVAILABLE_WARNING =
  'DRAFT_TEAMS_UNAVAILABLE: Sleeper roster/user data unavailable; draft ownership IDs remain available but names are omitted.';
const TRADED_PICKS_UNAVAILABLE_WARNING =
  'TRADED_PICKS_UNAVAILABLE: Sleeper traded-pick data unavailable; complete current-season ownership is omitted.';

type DraftType = 'snake' | 'linear' | 'auction' | 'unknown';
type PlacementStatus = 'confirmed' | 'projected' | 'unavailable';

interface TeamNames {
  teamName?: string;
  ownerName?: string;
}

interface ParsedTrades {
  available: boolean;
  valid: SleeperTradedPick[];
  malformed: number;
  conflicts: number;
  conflictedKeys: Set<string>;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function asNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function asRosterId(value: unknown): number | undefined {
  if (typeof value === 'number') return asPositiveInteger(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return asPositiveInteger(Number(value));
  return undefined;
}

function expectedSleeperSport(sport: SleeperSportConfig['sport']): 'nfl' | 'nba' {
  return sport === 'football' ? 'nfl' : 'nba';
}

function isCandidateDraft(value: unknown, leagueId: string, season: string, sport: string): value is SleeperDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return (
    asNonEmptyString(draft.draft_id) !== undefined &&
    draft.league_id === leagueId &&
    draft.season === season &&
    draft.sport === sport
  );
}

function isValidTradedPick(value: unknown): value is SleeperTradedPick {
  if (!value || typeof value !== 'object') return false;
  const pick = value as Record<string, unknown>;
  return (
    asNonEmptyString(pick.season) !== undefined &&
    asPositiveInteger(pick.round) !== undefined &&
    asPositiveInteger(pick.roster_id) !== undefined &&
    asPositiveInteger(pick.previous_owner_id) !== undefined &&
    asPositiveInteger(pick.owner_id) !== undefined
  );
}

function isDraftPick(value: unknown, selectedDraftId: string): value is SleeperDraftPick {
  if (!value || typeof value !== 'object') return false;
  const pick = value as Record<string, unknown>;
  return (
    asNonEmptyString(pick.player_id) !== undefined &&
    pick.draft_id === selectedDraftId &&
    asPositiveInteger(pick.round) !== undefined
  );
}

function tradeKey(pick: SleeperTradedPick): string {
  return `${pick.season}:${pick.round}:${pick.roster_id}`;
}

function parseTrades(value: unknown): ParsedTrades {
  if (!Array.isArray(value)) return { available: false, valid: [], malformed: 0, conflicts: 0, conflictedKeys: new Set() };
  const valid = value.filter(isValidTradedPick);
  const malformed = value.length - valid.length;
  const seen = new Map<string, number>();
  const conflictedKeys = new Set<string>();
  let conflicts = 0;
  for (const pick of valid) {
    const key = tradeKey(pick);
    const currentOwner = seen.get(key);
    if (currentOwner !== undefined && currentOwner !== pick.owner_id) {
      conflicts++;
      conflictedKeys.add(key);
    }
    seen.set(key, pick.owner_id);
  }
  return { available: true, valid, malformed, conflicts, conflictedKeys };
}

async function fetchOptionalJson(path: string): Promise<unknown | null> {
  try {
    const response = await sleeperFetch(path);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error(`[get-draft] optional fetch failed for ${path}:`, error);
    return null;
  }
}

function draftType(value: unknown): DraftType {
  return value === 'snake' || value === 'linear' || value === 'auction' ? value : 'unknown';
}

function draftSettings(draft: SleeperDraft): { teams?: number; rounds?: number; reversalRound?: number; reversalValid: boolean } {
  const settings = draft.settings;
  const teams = asPositiveInteger(settings?.teams);
  const rounds = asPositiveInteger(settings?.rounds);
  const reversalRaw = settings?.reversal_round;
  const reversalRound = asNonNegativeInteger(reversalRaw);
  // Sleeper's standard snake is explicitly encoded as reversal_round: 0.
  // Absence is not equivalent to 0: it leaves the unmade-board direction
  // unverified, so callers must not see a fabricated placement.
  const reversalValid = reversalRound !== undefined;
  return { teams, rounds, reversalRound, reversalValid };
}

function slotMap(draft: SleeperDraft, teams: number | undefined): Map<number, number> | undefined {
  if (!teams || !draft.slot_to_roster_id || typeof draft.slot_to_roster_id !== 'object') return undefined;
  const result = new Map<number, number>();
  const uniqueTeams = new Set<number>();
  for (let column = 1; column <= teams; column++) {
    const teamId = asRosterId(draft.slot_to_roster_id[String(column)]);
    if (!teamId || uniqueTeams.has(teamId)) return undefined;
    result.set(column, teamId);
    uniqueTeams.add(teamId);
  }
  return result;
}

function projectedSelectionInRound(
  type: DraftType,
  round: number,
  column: number,
  teams: number,
  reversalRound: number | undefined,
  reversalValid: boolean,
): number | undefined {
  if (type === 'linear') return column;
  if (type !== 'snake' || !reversalValid || reversalRound === undefined) return undefined;
  let forward = round % 2 === 1;
  if (reversalRound > 0 && round >= reversalRound) forward = !forward;
  return forward ? column : teams - column + 1;
}

function teamFields(teamId: number | undefined, names: Map<number, TeamNames>, prefix: string): Record<string, string> {
  if (!teamId) return {};
  const entry = names.get(teamId);
  return {
    ...(entry?.teamName ? { [`${prefix}TeamName`]: entry.teamName } : {}),
    ...(entry?.ownerName ? { [`${prefix}OwnerName`]: entry.ownerName } : {}),
  };
}

function metadataPlayer(pick: SleeperDraftPick): Record<string, unknown> {
  const metadata = pick.metadata;
  const derivedName = [asNonEmptyString(metadata?.first_name), asNonEmptyString(metadata?.last_name)]
    .filter(Boolean)
    .join(' ') || undefined;
  const fullName = asNonEmptyString(metadata?.full_name) ?? derivedName;
  return {
    playerId: pick.player_id!,
    ...(fullName ? { playerName: fullName } : {}),
    ...(asNonEmptyString(metadata?.position) ? { playerPosition: asNonEmptyString(metadata?.position) } : {}),
    // This comes from the pick's own historical metadata. It is intentionally
    // named proTeam, rather than `team`, and is never filled from the current
    // players cache.
    ...(asNonEmptyString(metadata?.team) ? { playerProTeam: asNonEmptyString(metadata?.team) } : {}),
  };
}

function auctionAmount(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
}

function normalizeDraftStatus(value: unknown): 'pre_draft' | 'in_progress' | 'complete' | 'unavailable' | 'unknown' {
  switch (value) {
    case 'pre_draft':
      return 'pre_draft';
    case 'drafting':
    case 'in_progress':
      return 'in_progress';
    case 'complete':
      return 'complete';
    case 'unavailable':
      return 'unavailable';
    default:
      return 'unknown';
  }
}

async function loadTeamNames(leagueId: string): Promise<{ names: Map<number, TeamNames>; available: boolean }> {
  const [rostersRaw, usersRaw] = await Promise.all([
    fetchOptionalJson(`/league/${leagueId}/rosters`),
    fetchOptionalJson(`/league/${leagueId}/users`),
  ]);
  if (!Array.isArray(rostersRaw) || !Array.isArray(usersRaw)) return { names: new Map(), available: false };

  const rosters = rostersRaw as SleeperRoster[];
  const users = usersRaw as SleeperLeagueUser[];
  const directory = buildUserDirectory(users);
  const names = new Map<number, TeamNames>();
  for (const roster of rosters) {
    const rosterId = asPositiveInteger(roster?.roster_id);
    const entry = roster && typeof roster.owner_id === 'string' ? directory.get(roster.owner_id) : undefined;
    if (!rosterId || !entry) continue;
    names.set(rosterId, { teamName: entry.teamName, ownerName: entry.displayName });
  }
  return { names, available: true };
}

function makeOwnershipEntry(
  seasonYear: number,
  round: number,
  originalTeamId: number,
  currentOwnerTeamId: number,
  placement: { status: PlacementStatus; source: 'provider_pick' | 'provider_order_derived' | 'no_provider_order' },
  names: Map<number, TeamNames>,
  position?: { draftColumn?: number; selectionInRound?: number; overallPick?: number },
): Record<string, unknown> {
  return {
    seasonYear,
    round,
    originalTeamId,
    currentOwnerTeamId,
    placement,
    ...(position?.draftColumn ? { draftColumn: position.draftColumn } : {}),
    ...(position?.selectionInRound ? { selectionInRound: position.selectionInRound } : {}),
    ...(position?.overallPick ? { overallPick: position.overallPick } : {}),
    ...teamFields(originalTeamId, names, 'original'),
    ...teamFields(currentOwnerTeamId, names, 'currentOwner'),
  };
}

function noDraftResponse(
  sport: SleeperSportConfig['sport'],
  leagueId: string,
  seasonYear: number,
  trades: ParsedTrades,
  names: Map<number, TeamNames>,
  warnings: string[],
): Record<string, unknown> | null {
  const season = String(seasonYear);
  const targetTrades = trades.valid.filter((pick) => pick.season === season && !trades.conflictedKeys.has(tradeKey(pick)));
  if (targetTrades.length === 0) return null;
  if (trades.malformed > 0) warnings.push(`DRAFT_OWNERSHIP_PARTIAL: ${trades.malformed} malformed traded-pick entries omitted.`);
  if (trades.conflicts > 0) warnings.push(`DRAFT_OWNERSHIP_CONFLICT: ${trades.conflicts} conflicting traded-pick entries omitted.`);
  return {
    platform: 'sleeper',
    sport,
    leagueId,
    seasonYear,
    draft: { type: 'unknown', status: 'unavailable', source: 'traded_picks_only' },
    picks: [],
    ownership: {
      scope: 'changed_picks_only',
      picks: targetTrades.map((pick) => makeOwnershipEntry(
        seasonYear,
        pick.round,
        pick.roster_id,
        pick.owner_id,
        { status: 'unavailable', source: 'no_provider_order' },
        names,
      )),
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export function createGetDraftHandler(config: SleeperSportConfig): HandlerFn {
  return async (_env, params) => {
    const { league_id: leagueId, season_year: seasonYear, draft_id: explicitDraftId } = params;
    if (!leagueId) return { success: false, error: 'league_id is required for get_draft', code: ErrorCode.MISSING_PARAM };

    try {
      const [leagueRes, draftsRes] = await Promise.all([
        sleeperFetch(`/league/${leagueId}`),
        sleeperFetch(`/league/${leagueId}/drafts`),
      ]);
      if (!leagueRes.ok) handleSleeperError(leagueRes);
      if (!draftsRes.ok) handleSleeperError(draftsRes);

      const league = await leagueRes.json() as SleeperLeague;
      const draftsRaw = await draftsRes.json() as unknown;
      if (!Array.isArray(draftsRaw)) {
        return { success: false, error: 'Sleeper returned an invalid draft list', code: 'DRAFT_UNAVAILABLE' };
      }

      const season = String(seasonYear);
      const candidates = draftsRaw.filter((draft) => isCandidateDraft(draft, leagueId, season, expectedSleeperSport(config.sport)));
      const warnings: string[] = [];

      // Team/name data and traded picks never decide which draft is selected.
      // They are only enrichment / current-owner data once a candidate is known.
      const teamNamesPromise = loadTeamNames(leagueId);
      const tradesPromise = fetchOptionalJson(`/league/${leagueId}/traded_picks`);

      let selected: SleeperDraft | undefined;
      if (explicitDraftId !== undefined) {
        selected = candidates.find((draft) => draft.draft_id === explicitDraftId);
        if (!selected) {
          return { success: false, error: 'The requested draft_id does not match a validated draft for this league, season, and sport', code: 'DRAFT_UNAVAILABLE' };
        }
      } else {
        const leagueDraftId = asNonEmptyString(league.draft_id);
        selected = leagueDraftId ? candidates.find((draft) => draft.draft_id === leagueDraftId) : undefined;
        if (!selected && candidates.length === 1) selected = candidates[0];
        if (!selected && candidates.length > 1) {
          return { success: false, error: 'Sleeper returned multiple matching drafts; specify draft_id to select one', code: 'SLEEPER_DRAFT_AMBIGUOUS' };
        }
      }

      const [teamResult, tradesRaw] = await Promise.all([teamNamesPromise, tradesPromise]);
      if (!teamResult.available) warnings.push(DRAFT_TEAMS_UNAVAILABLE_WARNING);
      const trades = parseTrades(tradesRaw);

      if (!selected) {
        const leagueSeason = Number(league.season);
        const currentOrFutureSeason = Number.isInteger(leagueSeason) && seasonYear >= leagueSeason;
        const changedPicksLedger = currentOrFutureSeason
          ? noDraftResponse(config.sport, leagueId, seasonYear, trades, teamResult.names, warnings)
          : null;
        if (changedPicksLedger) return { success: true, data: changedPicksLedger };
        return { success: false, error: 'Sleeper has no validated draft or current-season traded-pick ledger for this request', code: 'DRAFT_UNAVAILABLE' };
      }

      const [detailRes, picksRes] = await Promise.all([
        sleeperFetch(`/draft/${selected.draft_id}`),
        sleeperFetch(`/draft/${selected.draft_id}/picks`),
      ]);
      if (!detailRes.ok) handleSleeperError(detailRes);
      if (!picksRes.ok) handleSleeperError(picksRes);

      const detail = await detailRes.json() as SleeperDraft;
      const picksRaw = await picksRes.json() as unknown;
      if (!isCandidateDraft(detail, leagueId, season, expectedSleeperSport(config.sport)) || detail.draft_id !== selected.draft_id) {
        return { success: false, error: 'Sleeper draft detail did not match the selected league, season, sport, and draft id', code: 'DRAFT_UNAVAILABLE' };
      }
      if (!Array.isArray(picksRaw)) {
        return { success: false, error: 'Sleeper returned an invalid draft picks payload', code: 'DRAFT_UNAVAILABLE' };
      }

      const type = draftType(detail.type);
      const settings = draftSettings(detail);
      const slots = slotMap(detail, settings.teams);
      const validPicks = picksRaw.filter((pick) => isDraftPick(pick, selected!.draft_id));
      const malformedPicks = picksRaw.length - validPicks.length;
      if (malformedPicks > 0) warnings.push(`DRAFT_PICKS_PARTIAL: ${malformedPicks} malformed pick entries omitted.`);

      const normalizedPicks = validPicks.map((pick) => {
        const round = asPositiveInteger(pick.round);
        const pickNo = asPositiveInteger(pick.pick_no);
        const pickNoConsistent = Boolean(
          round && pickNo && settings.teams && Math.floor((pickNo - 1) / settings.teams) + 1 === round,
        );
        const draftColumn = asPositiveInteger(pick.draft_slot);
        const selectionTeamId = asRosterId(pick.roster_id);
        const originalTeamId = draftColumn ? slots?.get(draftColumn) : undefined;
        const selectionInRound = pickNoConsistent && settings.teams ? ((pickNo! - 1) % settings.teams) + 1 : undefined;

        return {
          ...metadataPlayer(pick),
          ...(round ? { round } : {}),
          ...(pickNoConsistent ? { overallPick: pickNo! } : {}),
          ...(selectionInRound ? { selectionInRound } : {}),
          ...(draftColumn ? { draftColumn } : {}),
          ...(selectionTeamId ? { selectionTeamId, ...teamFields(selectionTeamId, teamResult.names, 'selection') } : {}),
          ...(originalTeamId ? { originalTeamId, ...teamFields(originalTeamId, teamResult.names, 'original') } : {}),
          placement: {
            status: 'confirmed' as const,
            source: 'provider_pick' as const,
          },
          ...(typeof pick.is_keeper === 'boolean' ? { isKeeper: pick.is_keeper } : {}),
          ...(type === 'auction' && auctionAmount(pick.metadata?.amount) !== undefined
            ? { cost: { amount: auctionAmount(pick.metadata?.amount), unit: 'auction_dollars' } }
            : {}),
        };
      });

      const targetTrades = trades.valid.filter((pick) => pick.season === season && !trades.conflictedKeys.has(tradeKey(pick)));
      const ownershipWarnings = trades.available
        ? [
          ...(trades.malformed > 0 ? [`DRAFT_OWNERSHIP_PARTIAL: ${trades.malformed} malformed traded-pick entries omitted.`] : []),
          ...(trades.conflicts > 0 ? [`DRAFT_OWNERSHIP_CONFLICT: ${trades.conflicts} conflicting traded-pick entries omitted.`] : []),
        ]
        : [TRADED_PICKS_UNAVAILABLE_WARNING];
      warnings.push(...ownershipWarnings);

      const uniqueTrades = new Map<string, SleeperTradedPick>();
      for (const trade of targetTrades) {
        const key = tradeKey(trade);
        if (!uniqueTrades.has(key)) uniqueTrades.set(key, trade);
      }
      const completeOwnershipUsable = Boolean(
        slots && settings.teams && settings.rounds && trades.available && trades.malformed === 0 && trades.conflicts === 0,
      );

      let ownership: Record<string, unknown> | undefined;
      if (completeOwnershipUsable) {
        const ownershipPicks: Record<string, unknown>[] = [];
        for (let round = 1; round <= settings.rounds!; round++) {
          for (let column = 1; column <= settings.teams!; column++) {
            const originalTeamId = slots!.get(column)!;
            const trade = uniqueTrades.get(`${season}:${round}:${originalTeamId}`);
            const actual = normalizedPicks.find((pick) => pick.round === round && pick.draftColumn === column);
            const projected = projectedSelectionInRound(type, round, column, settings.teams!, settings.reversalRound, settings.reversalValid);
            ownershipPicks.push(makeOwnershipEntry(
              seasonYear,
              round,
              originalTeamId,
              trade?.owner_id ?? originalTeamId,
              actual
                ? { status: 'confirmed', source: 'provider_pick' }
                : projected
                  ? { status: 'projected', source: 'provider_order_derived' }
                  : { status: 'unavailable', source: 'no_provider_order' },
              teamResult.names,
              actual
                ? {
                  draftColumn: column,
                  selectionInRound: actual.selectionInRound as number | undefined,
                  overallPick: actual.overallPick as number | undefined,
                }
                : projected
                  ? {
                    draftColumn: column,
                    selectionInRound: projected,
                    overallPick: (round - 1) * settings.teams! + projected,
                  }
                  : { draftColumn: column },
            ));
          }
        }
        ownership = { scope: 'complete', picks: ownershipPicks };
      } else if (targetTrades.length > 0) {
        ownership = {
          scope: 'changed_picks_only',
          picks: targetTrades.map((trade) => makeOwnershipEntry(
            seasonYear,
            trade.round,
            trade.roster_id,
            trade.owner_id,
            { status: 'unavailable', source: 'no_provider_order' },
            teamResult.names,
          )),
        };
      } else {
        ownership = { scope: 'unavailable', picks: [] };
      }

      return {
        success: true,
        data: {
          platform: 'sleeper',
          sport: config.sport,
          leagueId,
          seasonYear,
          draft: {
            id: detail.draft_id,
            type,
            status: normalizeDraftStatus(detail.status),
            ...(typeof detail.start_time === 'number' && Number.isFinite(detail.start_time) ? { startTime: detail.start_time } : {}),
            ...(settings.teams ? { teams: settings.teams } : {}),
            ...(settings.rounds ? { rounds: settings.rounds } : {}),
          },
          picks: normalizedPicks,
          ...(ownership ? { ownership } : {}),
          ...(warnings.length > 0 ? { warnings: [...new Set(warnings)] } : {}),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
