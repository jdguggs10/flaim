/**
 * Cross-platform authentication middleware
 * Extracted from openai API route patterns
 */

import { AuthSession, AuthErrorResponse, UsageCheckResult } from './interfaces.js';
import { UsageTracker } from './usage-tracker.js';
import { isDevelopment } from './config.js';

// Authentication error responses
export const AUTH_ERRORS = {
  REQUIRED: 'Authentication required',
  INVALID_SESSION: 'Invalid session',
  RATE_LIMITED: 'Rate limit exceeded',
  USAGE_LIMIT: 'Free tier limit reached'
} as const;

// Core session verification - platform agnostic interface
export interface SessionVerifier {
  verifySession(token?: string): Promise<AuthSession | null>;
}

// Default session verifier (to be implemented by platform-specific code)
let sessionVerifier: SessionVerifier | null = null;

export function setSessionVerifier(verifier: SessionVerifier): void {
  sessionVerifier = verifier;
}

/**
 * Verify user session and return user data
 * Platform-agnostic wrapper around Clerk/other auth providers
 */
export async function verifySession(token?: string): Promise<AuthSession | null> {
  if (!sessionVerifier) {
    if (isDevelopment()) {
      console.warn('⚠️ No session verifier set, returning development user');
      return { userId: 'dev-user', isAuthenticated: true };
    }
    throw new Error('Session verifier not configured');
  }

  try {
    return await sessionVerifier.verifySession(token);
  } catch (error) {
    console.error('Session verification failed:', error);
    return null;
  }
}

/**
 * Require authentication - returns user or error response
 * Use this in API routes that need authentication
 */
export async function requireSession(token?: string): Promise<{ userId: string } | Response> {
  const session = await verifySession(token);
  
  if (!session || !session.isAuthenticated) {
    return createErrorResponse(AUTH_ERRORS.REQUIRED, 401);
  }

  return { userId: session.userId };
}

/**
 * Require authentication with usage limit check
 * Use this in API routes that consume user quota
 */
export async function requireSessionWithUsage(token?: string): Promise<{
  userId: string;
  canProceed: boolean;
  usage: UsageCheckResult;
} | Response> {
  const authResult = await requireSession(token);
  
  if (authResult instanceof Response) {
    return authResult; // Auth failed, return error response
  }

  const { userId } = authResult;
  const usageCheck = UsageTracker.canSendMessage(userId);

  if (!usageCheck.allowed) {
    const usageStats = UsageTracker.getUsageStats(userId);
    return createUsageLimitResponse(usageStats);
  }

  return {
    userId,
    canProceed: true,
    usage: usageCheck
  };
}

/**
 * Increment usage after successful API call
 */
export function incrementUsage(userId: string): void {
  UsageTracker.incrementUsage(userId);
}

/**
 * Create standardized error response
 */
export function createErrorResponse(
  error: string,
  status: number = 400,
  message?: string
): Response {
  const body: AuthErrorResponse = { error };
  if (message) body.message = message;

  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Create usage limit error response
 */
export function createUsageLimitResponse(usage: any): Response {
  return new Response(JSON.stringify({
    error: AUTH_ERRORS.USAGE_LIMIT,
    message: `You've reached your free tier limit of ${usage.limit} messages. Upgrade to continue.`,
    usage
  }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Extract authorization token from request headers
 */
export function extractToken(request: Request): string | undefined {
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  
  // Also check cookies for web requests
  const cookieHeader = request.headers.get('Cookie');
  const sessionMatch = cookieHeader?.match(/__session=([^;]+)/);
  return sessionMatch?.[1];
}

/**
 * Middleware factory for different auth requirements
 */
export function createAuthMiddleware(options: {
  requireAuth?: boolean;
  checkUsage?: boolean;
} = {}) {
  return async function authMiddleware(
    request: Request,
    handler: (userId: string) => Promise<Response>
  ): Promise<Response> {
    try {
      if (!options.requireAuth) {
        // No auth required, call handler with empty userId
        return await handler('');
      }

      const token = extractToken(request);
      
      if (options.checkUsage) {
        const result = await requireSessionWithUsage(token);
        if (result instanceof Response) return result;
        
        const response = await handler(result.userId);
        
        // Increment usage after successful call
        if (response.ok) {
          incrementUsage(result.userId);
        }
        
        return response;
      } else {
        const result = await requireSession(token);
        if (result instanceof Response) return result;
        
        return await handler(result.userId);
      }
    } catch (error) {
      console.error('Auth middleware error:', error);
      return createErrorResponse('Internal server error', 500);
    }
  };
}