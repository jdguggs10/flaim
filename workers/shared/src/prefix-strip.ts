/**
 * URL prefix stripping utility for custom domain routing
 *
 * When workers are accessed via custom domain routes (e.g., api.flaim.app/baseball/*),
 * the pathname includes the prefix. This utility strips it for internal routing.
 */

/**
 * Strip a prefix from a URL pathname
 *
 * @param pathname - The full pathname (e.g., "/baseball/health")
 * @param prefix - The prefix to strip (e.g., "/baseball")
 * @returns The pathname without the prefix (e.g., "/health"), or "/" if only prefix
 *
 * @example
 * stripPrefix("/baseball/health", "/baseball") // returns "/health"
 * stripPrefix("/baseball", "/baseball")        // returns "/"
 * stripPrefix("/health", "/baseball")          // returns "/health" (no match)
 */
export function stripPrefix(pathname: string, prefix: string): string {
  // Normalize prefix to start with /
  const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`;

  if (pathname.startsWith(normalizedPrefix)) {
    const stripped = pathname.slice(normalizedPrefix.length);
    return stripped || '/';
  }

  return pathname;
}

/**
 * Get pathname from a Request URL with optional prefix stripping
 *
 * @param request - The incoming request
 * @param prefix - Optional prefix to strip
 * @returns The pathname, with prefix stripped if specified
 */
export function getPathname(request: Request, prefix?: string): string {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (prefix) {
    return stripPrefix(pathname, prefix);
  }

  return pathname;
}
