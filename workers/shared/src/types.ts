/**
 * Shared TypeScript interfaces for Flaim workers
 */

/**
 * Base environment interface with auth-worker connection support.
 * Workers that call auth-worker should extend this.
 */
export interface BaseEnvWithAuth {
  NODE_ENV?: string;
  ENVIRONMENT?: string;
  AUTH_WORKER_URL: string;
  AUTH_WORKER?: Fetcher;  // Service binding for auth-worker
}

/**
 * ESPN credentials stored in Supabase via auth-worker
 */
export interface EspnCredentials {
  swid: string;
  s2: string;
  email?: string;
}

/**
 * League configuration from auth-worker
 */
export interface LeagueConfig {
  leagueId: string;
  sport: string;
  teamId?: string;
  seasonYear?: number;
}

/**
 * CORS middleware options
 */
export interface CorsOptions {
  /** Additional origins to allow (beyond the default set) */
  additionalOrigins?: string[];
  /** Additional HTTP methods to allow (beyond GET, POST, PUT, DELETE, OPTIONS) */
  additionalMethods?: string[];
  /** Additional headers to allow (beyond Content-Type, Authorization, X-Clerk-User-ID) */
  additionalHeaders?: string[];
  /** Cache preflight response duration in seconds (default: none) */
  maxAge?: number;
}
