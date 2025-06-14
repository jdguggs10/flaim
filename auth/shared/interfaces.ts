// Core authentication interfaces for cross-platform use
// Shared between web, iOS, and workers

// Core user authentication
export interface AuthUser {
  userId: string;
}

// Authentication session data
export interface AuthSession extends AuthUser {
  isAuthenticated: boolean;
}

// Plan types
export type UserPlan = 'free' | 'paid';

// Core usage tracking
export interface UserUsage {
  userId: string;
  messageCount: number;
  resetDate: string; // ISO date string
  plan: UserPlan;
}

// Usage statistics for frontend display
export interface UsageStats {
  plan: UserPlan;
  messageCount: number;
  limit: number | null;
  remaining: number | null;
  resetDate: string;
}

// Usage check result
export interface UsageCheckResult {
  allowed: boolean;
  usage: UserUsage;
  remaining?: number;
}

// Auth provider interface for platform implementations
export interface AuthProvider {
  getUser(): Promise<AuthUser | null>;
  verifySession(token?: string): Promise<AuthSession | null>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

// Standard API responses
export interface AuthErrorResponse {
  error: string;
  message?: string;
}

export interface UsageLimitResponse extends AuthErrorResponse {
  usage: UsageStats;
}

export interface SuccessResponse<T = any> {
  success: true;
  data?: T;
  message?: string;
}

// Usage API responses
export interface UsageResponse {
  success: boolean;
  usage?: UsageStats;
  error?: string;
}

// HTTP headers for usage tracking
export interface UsageHeaders {
  'X-Usage-Count': string;
  'X-Usage-Limit': string;
  'X-Usage-Remaining': string;
  'X-User-Plan': UserPlan;
}

// Configuration interfaces
export interface AuthConfig {
  clerkApiKey?: string;
  jwtSecret?: string;
  usageLimits: {
    free: number;
    paid: number | null; // null = unlimited
  };
}

// Environment adapter interface
export interface ConfigAdapter {
  getEnv(key: string): string | undefined;
}