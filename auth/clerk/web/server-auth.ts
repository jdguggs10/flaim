/**
 * Server-side authentication utilities for Clerk in Next.js
 * Extracted from openai API routes
 */

import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { AuthSession, SessionVerifier } from '../../shared/interfaces.js';
import { setSessionVerifier } from '../../shared/auth-middleware.js';

/**
 * Clerk session verifier implementation for Next.js
 */
class ClerkSessionVerifier implements SessionVerifier {
  async verifySession(token?: string): Promise<AuthSession | null> {
    try {
      // For Next.js, we use the auth() function which handles the session automatically
      const { userId } = await auth();
      
      if (!userId) {
        return null;
      }

      return {
        userId,
        isAuthenticated: true
      };
    } catch (error) {
      console.error('Clerk session verification failed:', error);
      return null;
    }
  }
}

// Initialize the session verifier
const clerkVerifier = new ClerkSessionVerifier();
setSessionVerifier(clerkVerifier);

/**
 * Get authenticated user from Clerk session
 * Direct wrapper around Clerk's auth() function
 */
export async function getAuthenticatedUser(): Promise<{ userId: string } | null> {
  try {
    const { userId } = await auth();
    return userId ? { userId } : null;
  } catch (error) {
    console.error('Failed to get authenticated user:', error);
    return null;
  }
}

/**
 * Require authentication in API routes
 * Returns user data or NextResponse error
 */
export async function requireAuth(): Promise<{ userId: string } | NextResponse> {
  const user = await getAuthenticatedUser();
  
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  return user;
}

/**
 * Create authenticated API route handler
 * Wrapper that ensures authentication before calling handler
 */
export function withAuth<T = any>(
  handler: (userId: string, request: NextRequest) => Promise<NextResponse<T>>
) {
  return async (request: NextRequest): Promise<NextResponse<T>> => {
    const authResult = await requireAuth();
    
    if (authResult instanceof NextResponse) {
      return authResult as NextResponse<T>;
    }

    return handler(authResult.userId, request);
  };
}

/**
 * Create authenticated API route handler with usage checking
 */
export function withAuthAndUsage<T = any>(
  handler: (userId: string, request: NextRequest) => Promise<NextResponse<T>>
) {
  return async (request: NextRequest): Promise<NextResponse<T>> => {
    // Import here to avoid circular dependency
    const { requireSessionWithUsage, incrementUsage } = await import('../../shared/auth-middleware.js');
    
    const result = await requireSessionWithUsage();
    
    if (result instanceof Response) {
      return NextResponse.json(await result.json(), { 
        status: result.status 
      }) as NextResponse<T>;
    }

    try {
      const response = await handler(result.userId, request);
      
      // Increment usage after successful API call
      if (response.ok) {
        incrementUsage(result.userId);
      }
      
      return response;
    } catch (error) {
      console.error('API handler error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      ) as NextResponse<T>;
    }
  };
}

/**
 * Extract user context from authenticated request
 * For use in server components and API routes
 */
export async function getUserContext() {
  const { userId, sessionClaims, sessionId } = await auth();
  
  return {
    userId,
    sessionId,
    sessionClaims,
    isAuthenticated: !!userId
  };
}

/**
 * Check if user has specific permissions
 * Placeholder for future role-based access control
 */
export async function hasPermission(permission: string): Promise<boolean> {
  const { sessionClaims } = await auth();
  
  // Future implementation: check permissions in sessionClaims
  // For now, all authenticated users have all permissions
  return !!sessionClaims;
}

// Re-export Clerk server utilities
export { auth } from '@clerk/nextjs/server';