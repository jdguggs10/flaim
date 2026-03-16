import { createYahooHandlers } from '../../shared/handlers';
import { getPositionFilter } from './mappings';

export const hockeyHandlers = createYahooHandlers({ sport: 'hockey', getPositionFilter });
