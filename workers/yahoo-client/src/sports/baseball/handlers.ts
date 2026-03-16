import { createYahooHandlers } from '../../shared/handlers';
import { getPositionFilter } from './mappings';

export const baseballHandlers = createYahooHandlers({
  sport: 'baseball',
  getPositionFilter,
  extraLeagueFields: (league) => ({
    startDate: league.start_date,
    endDate: league.end_date,
  }),
});
