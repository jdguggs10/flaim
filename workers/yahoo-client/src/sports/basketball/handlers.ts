import { createYahooHandlers } from '../../shared/handlers';
import { getPositionFilter } from './mappings';

export const basketballHandlers = createYahooHandlers({ sport: 'basketball', getPositionFilter });
