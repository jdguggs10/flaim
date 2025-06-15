/**
 * ESPN Gambit League Discovery Module
 * 
 * Public API exports for ESPN league discovery functionality
 */

// Core discovery functions
export { 
  discoverLeagues, 
  discoverLeaguesSafe, 
  filterLeaguesBySport, 
  getSportName 
} from './league-discovery.js';

// Types and schemas
export type { 
  GambitLeague, 
  GambitDashboardResponse, 
  LeagueDiscoveryResult,
  EspnGameId,
  SportName 
} from './schema.js';

export { ESPN_GAME_IDS } from './schema.js';

// Error classes
export { 
  AutomaticLeagueDiscoveryFailed, 
  EspnCredentialsRequired, 
  EspnAuthenticationFailed 
} from './errors.js';