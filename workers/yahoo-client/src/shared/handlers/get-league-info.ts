import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, toYahooBoolean, toYahooFiniteNumber, unwrapLeague, unwrapTeam } from '../normalizers';
import { ErrorCode } from '@flaim/worker-shared';
import { extractLeagueSettings, extractManagerName, toExecuteErrorResponse } from './utils';

const LEAGUE_SETTINGS_UNAVAILABLE_WARNING =
  'LEAGUE_SETTINGS_UNAVAILABLE: could not fetch league settings; draft/trade config fields omitted.';

export function createGetLeagueInfoHandler(config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { league_id } = params;

    if (!league_id) {
      return {
        success: false,
        error: 'league_id is required for get_league_info',
        code: ErrorCode.MISSING_PARAM,
      };
    }

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_league_info');

      const cid = correlationId || 'no-cid';

      // Fetch /teams first, exactly as before — this is the pre-existing,
      // already-working contract and must not be put at risk by anything
      // settings-related. The /settings sub-resource is a genuinely new
      // fetch (FLA-284) and runs SEQUENTIALLY after /teams, not
      // concurrently with it: Yahoo's aggressive throttling (HTTP 999) is
      // sensitive to concurrent requests per the team's operating posture,
      // and /settings is best-effort here (FLA-284 audit).
      const teamsResponse = await yahooFetch(`/league/${league_id}/teams`, { credentials });

      if (!teamsResponse.ok) {
        await handleYahooError(teamsResponse);
      }

      const raw = await teamsResponse.json();
      const leagueArray = getPath(raw, ['fantasy_content', 'league']);
      const league = unwrapLeague(leagueArray);

      // Extract teams from the /teams sub-resource
      const teamsObj = getPath(league, ['teams']) as Record<string, unknown> | undefined;
      const teamsArray = asArray(teamsObj);

      const teams = teamsArray.map((teamWrapper: unknown) => {
        const teamData = getPath(teamWrapper, ['team']) as unknown[];
        const team = unwrapTeam(teamData);
        return {
          teamKey: team.team_key as string | undefined,
          teamId: team.team_id as string | undefined,
          teamName: team.name as string | undefined,
          ownerName: extractManagerName(team),
        };
      });

      // Everything settings-related is isolated in its own try/catch so a
      // fetch failure, a malformed/unexpected settings payload, or anything
      // else in this block can only omit these fields and add a warning —
      // it can never throw out of the handler, and a /settings problem
      // never affects the /teams-derived data above. Field shapes per the
      // research brief (§3.2) and a real captured settings fixture; not
      // live-verified while Yahoo API access is cut (FLA-237).
      const warnings: string[] = [];
      let settingsFields: Record<string, unknown> = {};
      try {
        const settingsResponse = await yahooFetch(`/league/${league_id}/settings`, { credentials }).catch((error: unknown) => {
          console.warn(
            `[yahoo-client] ${cid} get_league_info settings fetch failed: ${error instanceof Error ? error.message : String(error)}`
          );
          return null;
        });

        if (settingsResponse && settingsResponse.ok) {
          const settingsRaw = await settingsResponse.json();
          const settingsLeagueArray = getPath(settingsRaw, ['fantasy_content', 'league']);
          const settingsMerged = unwrapLeague(settingsLeagueArray);
          const settings = extractLeagueSettings(settingsMerged.settings);
          if (settings) {
            settingsFields = {
              draftType: settings.draft_type,
              isAuctionDraft: toYahooBoolean(settings.is_auction_draft),
              canTradeDraftPicks: toYahooBoolean(settings.can_trade_draft_picks),
              tradeEndDate: settings.trade_end_date,
              tradeRatifyType: settings.trade_ratify_type,
              tradeRejectTime: toYahooFiniteNumber(settings.trade_reject_time),
              usesFaab: toYahooBoolean(settings.uses_faab),
            };
          } else {
            warnings.push(LEAGUE_SETTINGS_UNAVAILABLE_WARNING);
          }
        } else {
          warnings.push(LEAGUE_SETTINGS_UNAVAILABLE_WARNING);
        }
      } catch (settingsError) {
        console.warn(
          `[yahoo-client] ${cid} get_league_info settings processing failed: ${settingsError instanceof Error ? settingsError.message : String(settingsError)}`
        );
        warnings.push(LEAGUE_SETTINGS_UNAVAILABLE_WARNING);
      }

      return {
        success: true,
        data: {
          leagueKey: league.league_key,
          leagueId: league.league_id,
          name: league.name,
          url: league.url,
          numTeams: league.num_teams,
          scoringType: league.scoring_type,
          currentWeek: league.current_week,
          startWeek: league.start_week,
          endWeek: league.end_week,
          isFinished: league.is_finished === 1,
          draftStatus: league.draft_status,
          ...settingsFields,
          // Already present on the /teams response's core league metadata
          // (verified against a real settings fixture, same metadata block
          // Yahoo returns for any /league/{key}/* sub-resource) — no extra
          // fetch needed. `is_plus_league` was not found in any reference
          // fixture, so it's omitted rather than guessed at.
          ...(league.is_pro_league !== undefined ? { isProLeague: toYahooBoolean(league.is_pro_league) } : {}),
          teams,
          ...config.extraLeagueFields?.(league),
          ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
