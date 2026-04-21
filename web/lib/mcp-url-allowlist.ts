/**
 * MCP server URL allowlist — shared between debug routes and the chat API.
 * Prevents SSRF by restricting outbound MCP requests to known hosts.
 */

/** Valid MCP server host patterns. */
export const ALLOWED_MCP_HOST_PATTERNS = [
  'flaim.app',
  ...(process.env.NODE_ENV === 'development' ? ['localhost', '127.0.0.1', '[::1]'] : []),
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
    const hostname = url.hostname.toLowerCase();

    // Never allow embedded credentials in outbound MCP URLs.
    if (url.username || url.password) {
      return false;
    }

    // Must be HTTPS in production, allow HTTP for localhost
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    if (!isLocalhost && url.protocol !== 'https:') {
      return false;
    }

    // Keep remote traffic on default TLS port to reduce SSRF surface area.
    // Localhost can use custom ports for local development workflows.
    if (!isLocalhost && url.port && url.port !== '443') {
      return false;
    }

    // Check against static allowlist patterns
    const matchesStatic = ALLOWED_MCP_HOST_PATTERNS.some(pattern =>
      hostname === pattern || hostname.endsWith(`.${pattern}`)
    );
    if (matchesStatic) return true;

    // Check workers.dev — only allow known Flaim worker prefixes on our account
    // Format: <worker>.<account>.workers.dev (exactly 4 segments)
    if (hostname.endsWith('.workers.dev')) {
      const parts = hostname.split('.');
      return parts.length === 4
        && parts[1] === CF_ACCOUNT_SUBDOMAIN
        && ALLOWED_WORKER_PREFIXES.some(prefix => parts[0] === prefix);
    }

    return false;
  } catch {
    return false;
  }
}
