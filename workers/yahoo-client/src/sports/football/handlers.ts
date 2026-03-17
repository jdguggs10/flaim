import { createYahooHandlers } from '../../shared/handlers';
import { getPositionFilter } from './mappings';

export const footballHandlers = createYahooHandlers({ sport: 'football', getPositionFilter });
