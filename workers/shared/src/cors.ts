/**
 * CORS middleware factory for Flaim workers
 *
 * Provides a configurable CORS implementation with a sensible default allowlist.
 */

import type { CorsOptions } from './types.js';

/**
 * Default allowed origins for MCP workers (matches current behavior).
 */
const MCP_ALLOWED_ORIGINS = [
  'https://flaim-*.vercel.app', // Flaim preview deployments
  'https://flaim.vercel.app',   // Vercel production domain (fallback)
  'https://flaim.app',          // Production
  'http://localhost:8787',      // Wrangler dev server (HTTP)
  'https://localhost:8787',     // Wrangler dev server (HTTPS)
  'http://localhost:3000',      // Next.js dev server
];

/**
 * Auth-worker specific additions (kept explicit to avoid behavior drift).
 */
const AUTH_WORKER_ADDITIONAL_ORIGINS = [
  'https://www.flaim.app',      // Production with www subdomain
];

const AUTH_WORKER_ADDITIONAL_METHODS = ['PATCH'];
const AUTH_WORKER_MAX_AGE = 86400;

/**
 * Default allowed HTTP methods
 */
const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];

/**
 * Default allowed headers
 */
const DEFAULT_HEADERS = ['Content-Type', 'Authorization'];

/**
 * Check if an origin matches the allowlist (supports wildcards)
 */
function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.some(allowedOrigin => {
    if (allowedOrigin.includes('*')) {
      // Handle wildcard patterns (e.g., https://*.vercel.app)
      const regex = wildcardToRegex(allowedOrigin);
      return regex.test(origin);
    }
    return allowedOrigin === origin;
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.split('*').map(escapeRegex).join('.*');
  return new RegExp(`^${escaped}$`);
}

function mergeUnique(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Create CORS headers for a request
 */
export function createCorsHeaders(request: Request, options: CorsOptions = {}): Record<string, string> {
  const origin = request.headers.get('Origin');

  // Build allowlist
  const allowedOrigins = [
    ...MCP_ALLOWED_ORIGINS,
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
 * Convenience helpers to preserve existing per-worker behavior.
 */
export function createMcpCorsHeaders(request: Request, options: CorsOptions = {}): Record<string, string> {
  return createCorsHeaders(request, options);
}

export function handleMcpCorsPreflightResponse(request: Request, options: CorsOptions = {}): Response {
  return new Response(null, {
    status: 200,
    headers: createMcpCorsHeaders(request, options),
  });
}

export function createAuthWorkerCorsHeaders(request: Request, options: CorsOptions = {}): Record<string, string> {
  const mergedOptions: CorsOptions = {
    ...options,
    additionalOrigins: mergeUnique([
      ...AUTH_WORKER_ADDITIONAL_ORIGINS,
      ...(options.additionalOrigins || []),
    ]),
    additionalMethods: mergeUnique([
      ...AUTH_WORKER_ADDITIONAL_METHODS,
      ...(options.additionalMethods || []),
    ]),
    maxAge: options.maxAge ?? AUTH_WORKER_MAX_AGE,
  };

  return createCorsHeaders(request, mergedOptions);
}

export function handleAuthWorkerCorsPreflightResponse(request: Request, options: CorsOptions = {}): Response {
  return new Response(null, {
    status: 200,
    headers: createAuthWorkerCorsHeaders(request, options),
  });
}

/**
 * Check if a request is a CORS preflight request
 */
export function isCorsPreflightRequest(request: Request): boolean {
  return request.method === 'OPTIONS';
}
