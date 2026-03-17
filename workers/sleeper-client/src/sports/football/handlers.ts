import { createSleeperHandlers } from '../../shared/handlers';

export const footballHandlers = createSleeperHandlers({ sport: 'football', statePath: '/state/nfl' });
