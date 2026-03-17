import type { HandlerFn, YahooHandlerContext, YahooSportConfig } from './types';
import { createSearchPlayersHandler } from './search-players';
import { createGetLeagueInfoHandler } from './get-league-info';
import { createGetStandingsHandler } from './get-standings';
import { createGetRosterHandler } from './get-roster';
import { createGetMatchupsHandler } from './get-matchups';
import { createGetFreeAgentsHandler } from './get-free-agents';
import { createGetTransactionsHandler } from './get-transactions';

export type { HandlerFn, YahooSportConfig } from './types';

export function createYahooHandlers(config: YahooSportConfig): Record<string, HandlerFn> {
  const context: YahooHandlerContext = {
    ...config,
    logLabelSuffix: config.logLabelSuffix ?? (config.sport === 'baseball' ? ' (baseball)' : ''),
  };

  return {
    get_league_info: createGetLeagueInfoHandler(context),
    get_standings: createGetStandingsHandler(context),
    get_roster: createGetRosterHandler(context),
    get_matchups: createGetMatchupsHandler(context),
    get_free_agents: createGetFreeAgentsHandler(context),
    get_transactions: createGetTransactionsHandler(),
    get_players: createSearchPlayersHandler(context),
  };
}
