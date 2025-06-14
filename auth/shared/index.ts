/**
 * FLAIM Auth Module - Public API Surface
 * 
 * This is the only file that consumers should import from.
 * All implementation details are hidden behind this interface.
 * 
 * @version 1.0.0
 */

// Core authentication functions - the essential API
export { 
  verifySession, 
  requireSession, 
  requireSessionWithUsage,
  incrementUsage,
  createErrorResponse,
  createUsageLimitResponse,
  extractToken,
  createAuthMiddleware,
  setSessionVerifier
} from './auth-middleware.js';

// Usage tracking - business logic API
export { UsageTracker } from './usage-tracker.js';

// Configuration - environment setup
export { AuthConfig, validateAuthConfig, isDevelopment, isProduction } from './config.js';

// Token management - session lifecycle
export { TokenManager } from './token-manager.js';

// Core types and interfaces - data contracts
export type {
  // Authentication types
  AuthUser,
  AuthSession,
  AuthProvider,
  SessionVerifier,
  
  // Usage tracking types
  UserPlan,
  UserUsage,
  UsageStats,
  UsageCheckResult,
  
  // API response types
  AuthErrorResponse,
  UsageLimitResponse,
  SuccessResponse,
  UsageResponse,
  UsageHeaders,
  
  // Configuration types
  AuthConfig as AuthConfigType,
  ConfigAdapter,
  
  // Token management types
  TokenRefreshProvider,
  SessionEvent,
  TokenEventListener
} from './interfaces.js';

// Constants for common use
export const AUTH_ERRORS = {
  REQUIRED: 'Authentication required',
  INVALID_SESSION: 'Invalid session',
  RATE_LIMITED: 'Rate limit exceeded',
  USAGE_LIMIT: 'Free tier limit reached'
} as const;

// Version information
export const VERSION = '1.0.0';

/**
 * Initialize the auth system with platform-specific providers
 * 
 * @example
 * ```typescript
 * import { initializeAuth } from '@flaim/auth';
 * import { ClerkSessionVerifier } from '@flaim/auth/clerk/web';
 * 
 * initializeAuth({
 *   sessionVerifier: new ClerkSessionVerifier()
 * });
 * ```
 */
export function initializeAuth(options: {
  sessionVerifier?: import('./interfaces.js').SessionVerifier;
  tokenRefreshProvider?: import('./token-manager.js').TokenRefreshProvider;
}) {
  if (options.sessionVerifier) {
    setSessionVerifier(options.sessionVerifier);
  }
  
  if (options.tokenRefreshProvider) {
    TokenManager.setRefreshProvider(options.tokenRefreshProvider);
  }
}

/**
 * Health check function for the auth system
 */
export function getAuthSystemHealth() {
  const config = validateAuthConfig();
  
  return {
    version: VERSION,
    configValid: config.valid,
    configErrors: config.errors,
    environment: isDevelopment() ? 'development' : 'production',
    timestamp: new Date().toISOString()
  };
}