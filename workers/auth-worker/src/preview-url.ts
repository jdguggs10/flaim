/**
 * Vercel preview URL pattern. Matches:
 *   - flaim.vercel.app
 *   - flaim-git-branch-name-gerald-guggers-projects.vercel.app
 *   - flaim-abc123def-gerald-guggers-projects.vercel.app
 *
 * Character class [a-z0-9-] is intentional — Vercel normalizes branch names
 * to lowercase and converts underscores to hyphens.
 */
const VERCEL_PREVIEW_PATTERN = /^https:\/\/flaim(-[a-z0-9-]+)?\.vercel\.app$/;

/**
 * Extract a valid Vercel preview origin from a request.
 * Returns the origin if it matches the preview URL pattern, undefined otherwise.
 */
export function resolvePreviewOrigin(request: Request): string | undefined {
  const origin = request.headers.get('Origin') || request.headers.get('Referer');
  if (!origin) return undefined;
  const url = origin.startsWith('http') ? new URL(origin).origin : origin;
  return VERCEL_PREVIEW_PATTERN.test(url) ? url : undefined;
}

interface FrontendUrlEnv {
  FRONTEND_URL?: string;
  ENVIRONMENT?: string;
  NODE_ENV?: string;
}

/**
 * Resolve the frontend URL for OAuth redirects.
 * Priority: FRONTEND_URL env var > localhost (dev) > preview origin > flaim.app
 */
export function getFrontendUrl(env: FrontendUrlEnv, request?: Request): string {
  if (env.FRONTEND_URL) {
    return env.FRONTEND_URL.replace(/\/$/, '');
  }
  if (env.ENVIRONMENT === 'dev' || env.NODE_ENV === 'development') {
    return 'http://localhost:3000';
  }
  if (env.ENVIRONMENT === 'preview' && request) {
    const previewOrigin = resolvePreviewOrigin(request);
    if (previewOrigin) return previewOrigin;
  }
  return 'https://flaim.app';
}
