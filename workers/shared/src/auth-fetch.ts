/**
 * Auth-worker fetch helper for MCP workers
 *
 * Provides a unified way to call auth-worker using:
 * 1. Service binding (preferred) - avoids Cloudflare error 1042 for same-zone calls
 * 2. URL fallback - for local development or when binding is unavailable
 */

import type { BaseEnvWithAuth } from './types.js';

/**
 * Fetch from auth-worker using service binding (preferred) or URL fallback.
 *
 * Service bindings avoid Cloudflare error 1042 for same-zone worker-to-worker calls.
 *
 * @param env - Environment with AUTH_WORKER binding and AUTH_WORKER_URL fallback
 * @param path - The path to fetch (e.g., "/credentials/espn")
 * @param init - Optional fetch init options
 * @returns The fetch response
 *
 * @example
 * const response = await authWorkerFetch(env, '/credentials/espn', {
 *   method: 'GET',
 *   headers: { 'Authorization': authHeader }
 * });
 */
export function authWorkerFetch(
  env: BaseEnvWithAuth,
  path: string,
  init?: RequestInit
): Promise<Response> {
  // Ensure path starts with /
  const safePath = path.startsWith('/') ? path : `/${path}`;

  // Prefer service binding
  if (env.AUTH_WORKER) {
    const url = new URL(safePath, 'https://auth-worker.internal');
    return env.AUTH_WORKER.fetch(new Request(url.toString(), init));
  }

  // Log warning in prod when binding is missing
  if (env.ENVIRONMENT === 'prod') {
    console.warn('[authWorkerFetch] AUTH_WORKER binding missing in prod; using URL fallback');
  }

  // Fall back to URL
  if (!env.AUTH_WORKER_URL) {
    throw new Error('AUTH_WORKER_URL is not configured and AUTH_WORKER binding is unavailable');
  }

  return fetch(`${env.AUTH_WORKER_URL}${safePath}`, init);
}
