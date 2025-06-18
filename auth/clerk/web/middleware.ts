/**
 * Clerk middleware configuration for Next.js
 * Extracted from openai/middleware.ts
 */

import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Default Clerk middleware configuration for FLAIM applications
 */
export const defaultClerkMiddleware = clerkMiddleware();

/**
 * Enhanced Clerk middleware with custom logic
 */
export function createClerkMiddleware(options: {
  publicRoutes?: string[];
  ignoredRoutes?: string[];
  afterAuth?: (auth: any, request: NextRequest) => NextResponse | void;
} = {}) {
  return clerkMiddleware(async (auth, request) => {
    const { userId } = await auth();
    const { pathname } = request.nextUrl;

    // Apply custom after-auth logic
    if (options.afterAuth) {
      const result = options.afterAuth(auth, request);
      if (result) return result;
    }

    // Default behavior - let Clerk handle authentication
    return NextResponse.next();
  });
}

/**
 * Middleware configuration matcher
 * Based on openai/middleware.ts patterns
 */
export const clerkMiddlewareConfig = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};

/**
 * FLAIM-specific middleware with common patterns
 */
export const flaimClerkMiddleware = createClerkMiddleware({
  afterAuth: (auth, request) => {
    const { userId } = auth();
    const { pathname } = request.nextUrl;

    // Add custom headers for debugging in development
    if (process.env.NODE_ENV === 'development') {
      const response = NextResponse.next();
      response.headers.set('x-user-id', userId || 'anonymous');
      response.headers.set('x-pathname', pathname);
      return response;
    }

    // Add usage tracking headers for API routes
    if (pathname.startsWith('/api/') && userId) {
      const response = NextResponse.next();
      response.headers.set('x-authenticated-user', userId);
      return response;
    }
  }
});

// Export default middleware for easy import
export default defaultClerkMiddleware;
export { clerkMiddleware };