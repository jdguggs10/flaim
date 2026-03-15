/**
 * MCP server URL allowlist — shared between debug routes and the chat API.
 * Prevents SSRF by restricting outbound MCP requests to known hosts.
 */

/** Valid MCP server host patterns. */
export const ALLOWED_MCP_HOST_PATTERNS = [
  'flaim.app',
  ...(process.env.NODE_ENV === 'development' ? ['localhost', '127.0.0.1'] : []),
];

/** Flaim CF account subdomain. Workers are <name>.gerrygugger.workers.dev. */
export const CF_ACCOUNT_SUBDOMAIN = 'gerrygugger';

/** Flaim-specific worker name prefixes allowed on workers.dev. */
export const ALLOWED_WORKER_PREFIXES = [
  'fantasy-mcp',
  'fantasy-mcp-preview',
  'auth-worker',
  'auth-worker-preview',
];

/** Validate that a URL is safe to fetch (SSRF protection). */
export function isAllowedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);

    // Must be HTTPS in production, allow HTTP for localhost
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (!isLocalhost && url.protocol !== 'https:') {
      return false;
    }

    // Check against static allowlist patterns
    const matchesStatic = ALLOWED_MCP_HOST_PATTERNS.some(pattern =>
      url.hostname === pattern || url.hostname.endsWith(`.${pattern}`)
    );
    if (matchesStatic) return true;

    // Check workers.dev — only allow known Flaim worker prefixes on our account
    // Format: <worker>.<account>.workers.dev (exactly 4 segments)
    if (url.hostname.endsWith('.workers.dev')) {
      const parts = url.hostname.split('.');
      return parts.length === 4
        && parts[1] === CF_ACCOUNT_SUBDOMAIN
        && ALLOWED_WORKER_PREFIXES.some(prefix => parts[0] === prefix);
    }

    return false;
  } catch {
    return false;
  }
}
