import type { HandlerFn, SleeperSportConfig } from './types';
import { createSleeperGetFreeAgentsHandler } from '../sleeper-free-agents-handler';
import { createSearchPlayersHandler } from './search-players';
import { createGetLeagueInfoHandler } from './get-league-info';
import { createGetStandingsHandler } from './get-standings';
import { createGetRosterHandler } from './get-roster';
import { createGetMatchupsHandler } from './get-matchups';
import { createGetTransactionsHandler } from './get-transactions';

export type { HandlerFn, SleeperSportConfig } from './types';

export function createSleeperHandlers(config: SleeperSportConfig): Record<string, HandlerFn> {
  return {
    get_league_info: createGetLeagueInfoHandler(),
    get_standings: createGetStandingsHandler(),
    get_roster: createGetRosterHandler(),
    get_matchups: createGetMatchupsHandler(config),
    get_free_agents: createSleeperGetFreeAgentsHandler(config.sport),
    get_transactions: createGetTransactionsHandler(config),
    get_players: createSearchPlayersHandler(config),
  };
}
