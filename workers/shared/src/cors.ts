/**
 * CORS middleware factory for Flaim workers
 *
 * Provides a configurable CORS implementation with a sensible default allowlist.
 */

import type { CorsOptions } from './types.js';

/**
 * Default allowed origins for all Flaim workers
 */
const DEFAULT_ALLOWED_ORIGINS = [
  'https://*.vercel.app',       // All Vercel preview deployments
  'https://flaim.app',          // Production
  'https://www.flaim.app',      // Production with www subdomain
  'http://localhost:8787',      // Wrangler dev server (HTTP)
  'https://localhost:8787',     // Wrangler dev server (HTTPS)
  'http://localhost:3000',      // Next.js dev server
];

/**
 * Default allowed HTTP methods
 */
const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];

/**
 * Default allowed headers
 */
const DEFAULT_HEADERS = ['Content-Type', 'Authorization', 'X-Clerk-User-ID'];

/**
 * Check if an origin matches the allowlist (supports wildcards)
 */
function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.some(allowedOrigin => {
    if (allowedOrigin.includes('*')) {
      // Handle wildcard patterns (e.g., https://*.vercel.app)
      const pattern = allowedOrigin.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(origin);
    }
    return allowedOrigin === origin;
  });
}

/**
 * Create CORS headers for a request
 */
export function createCorsHeaders(request: Request, options: CorsOptions = {}): Record<string, string> {
  const origin = request.headers.get('Origin');

  // Build allowlist
  const allowedOrigins = [
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(options.additionalOrigins || []),
  ];

  // Build methods list
  const methods = [
    ...DEFAULT_METHODS,
    ...(options.additionalMethods || []),
  ];

  // Build headers list
  const allowedHeaders = [
    ...DEFAULT_HEADERS,
    ...(options.additionalHeaders || []),
  ];

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': methods.join(', '),
    'Access-Control-Allow-Headers': allowedHeaders.join(', '),
  };

  // Add max-age if specified
  if (options.maxAge !== undefined) {
    headers['Access-Control-Max-Age'] = String(options.maxAge);
  }

  // Add origin if allowed
  if (origin && isOriginAllowed(origin, allowedOrigins)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

/**
 * Handle CORS preflight (OPTIONS) request
 */
export function handleCorsPreflightResponse(request: Request, options: CorsOptions = {}): Response {
  return new Response(null, {
    status: 200,
    headers: createCorsHeaders(request, options),
  });
}

/**
 * Check if a request is a CORS preflight request
 */
export function isCorsPreflightRequest(request: Request): boolean {
  return request.method === 'OPTIONS';
}
