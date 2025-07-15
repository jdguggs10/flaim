import { AuthConfig, ConfigAdapter } from './interfaces.js';

// Platform-specific config adapters
class WebConfigAdapter implements ConfigAdapter {
  getEnv(key: string): string | undefined {
    return process.env[key];
  }
}

class IOSConfigAdapter implements ConfigAdapter {
  getEnv(key: string): string | undefined {
    // Future implementation for iOS plist/bundle
    // return Bundle.main.object(forInfoDictionaryKey: key) as string;
    throw new Error('iOS config adapter not yet implemented');
  }
}

// Auto-detect platform and use appropriate adapter
function getConfigAdapter(): ConfigAdapter {
  if (typeof process !== 'undefined' && process.env) {
    return new WebConfigAdapter();
  }
  
  // Future: detect iOS environment
  // if (typeof Bundle !== 'undefined') {
  //   return new IOSConfigAdapter();
  // }
  
  throw new Error('Unsupported platform for config loading');
}

// Environment-agnostic config loader
const adapter = getConfigAdapter();

function getEnv(key: string): string | undefined {
  return adapter.getEnv(key);
}

// Centralized auth configuration
export const authConfig: AuthConfig = {
  clerkApiKey: getEnv('CLERK_SECRET_KEY'),
  jwtSecret: getEnv('JWT_SECRET') || getEnv('CLERK_SECRET_KEY'), // fallback
  usageLimits: {
    free: parseInt(getEnv('FREE_TIER_LIMIT') || '100', 10),
    paid: null // unlimited for paid users
  }
};

// Export adapter for custom usage
export { getConfigAdapter, getEnv };

// Environment helpers
export const isDevelopment = () => getEnv('NODE_ENV') === 'development';
export const isProduction = () => getEnv('NODE_ENV') === 'production';

// Application environment helpers (use these for logic control)
export const isLocalDev = () => getEnv('ENVIRONMENT') === 'dev';
export const isPreview = () => getEnv('ENVIRONMENT') === 'preview';
export const isProd = () => getEnv('ENVIRONMENT') === 'prod';

// Validation helper
export function validateAuthConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!authConfig.clerkApiKey && isProd()) {
    errors.push('CLERK_SECRET_KEY is required in production');
  }
  
  if (authConfig.usageLimits.free <= 0) {
    errors.push('FREE_TIER_LIMIT must be greater than 0');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}