/**
 * Server-side authentication utilities for Clerk in Next.js
 * Extracted from openai API routes
 */

import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { SessionVerifier } from '../../shared/auth-middleware.js';
import { AuthSession } from '../../shared/interfaces.js';
import { setSessionVerifier } from '../../shared/auth-middleware.js';

/**
 * Union type for all possible auth wrapper responses
 */
type AuthResponse<TSuccess> =
  | NextResponse            // redirect or early exit (auth failure)
  | NextResponse<TSuccess>  // successful JSON response
  | NextResponse<{ error: string }>; // error JSON response

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
export function withAuth<TSuccess>(
  handler: (userId: string, request: NextRequest) => Promise<NextResponse<TSuccess>>
): (request: NextRequest) => Promise<AuthResponse<TSuccess>> {
  return async (request: NextRequest) => {
    const authResult = await requireAuth();
    
    if (authResult instanceof NextResponse) {
      return authResult; // redirect or auth failure
    }

    try {
      return await handler(authResult.userId, request); // success
    } catch (err: any) {
      console.error(`[withAuth] user=${authResult.userId} error=`, err);
      return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 }); // error
    }
  };
}

/**
 * Create authenticated API route handler with usage checking
 */
export function withAuthAndUsage<TSuccess>(
  handler: (userId: string, request: NextRequest) => Promise<NextResponse<TSuccess>>
): (request: NextRequest) => Promise<AuthResponse<TSuccess>> {
  return async (request: NextRequest) => {
    // Import here to avoid circular dependency
    const { requireSessionWithUsage, incrementUsage } = await import('../../shared/auth-middleware.js');
    
    const result = await requireSessionWithUsage();
    
    if (result instanceof Response) {
      return NextResponse.json(await result.json(), { 
        status: result.status 
      }); // auth failure or usage limit
    }

    try {
      const response = await handler(result.userId, request); // success
      
      // Increment usage after successful API call
      if (response.ok) {
        incrementUsage(result.userId);
      }
      
      return response;
    } catch (err: any) {
      console.error(`[withAuthAndUsage] user=${result.userId} error=`, err);
      return NextResponse.json(
        { error: err.message || 'Internal server error' },
        { status: 500 }
      ); // error
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