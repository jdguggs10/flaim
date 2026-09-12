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
  // Check X-Forwarded-Origin first (set by Next.js API proxies), then standard headers
  const origin = request.headers.get('X-Forwarded-Origin')
    || request.headers.get('Origin')
    || request.headers.get('Referer');
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
 *
 * Every current environment (dev/preview/prod, see wrangler.jsonc) sets
 * FRONTEND_URL explicitly, so the "preview origin" branch below is normally
 * unreachable — this is intentional, not dead code to prune. It exists as a
 * defensive fallback for handleAuthorize (the MCP client's /authorize
 * redirect): if FRONTEND_URL were ever accidentally unset for preview, this
 * branch tries to recover the calling PR-branch's Vercel URL from the
 * request's Origin/Referer header before falling through to production.
 *
 * That fallback rarely has anything to read in practice. Per the MCP
 * authorization spec, the client opens the user's browser directly at this
 * server's /authorize endpoint — there's no preceding Flaim webpage in that
 * navigation, so no flaim-*.vercel.app Origin/Referer header exists to
 * recover (browsers also don't send Origin at all on a plain GET
 * navigation). FRONTEND_URL's static, preview-wide default is what actually
 * makes the MCP OAuth consent redirect work today; removing it would send
 * that traffic to the final fallback (production) instead (FLA-281).
 *
 * The dynamic Origin/Referer lookup IS load-bearing elsewhere: Yahoo-connect
 * (yahoo-connect-handlers.ts) calls resolvePreviewOrigin() directly, not
 * through this function, from a request proxied by the Flaim frontend the
 * user is actively browsing — that request legitimately carries the header
 * this function is trying (and normally failing) to read.
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
