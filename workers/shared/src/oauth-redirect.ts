/**
 * OAuth redirect URI validation — shared across auth-worker and web.
 * Browser-safe: URL, Set, string ops only — zero imports.
 * RFC 9700: exact-match + locked structural checks.
 * RFC 8252: dynamic loopback port acceptance.
 */

const ALLOWED_REDIRECT_URIS = [
  // Claude.ai web + Claude Desktop (both route through claude.ai)
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  // ChatGPT MCP connectors (dynamic per-app paths matched below)
  'https://chatgpt.com/connector_platform_oauth_redirect',
  'https://platform.openai.com/apps-manage/oauth',
  // Perplexity custom connectors (pattern matched below for all subdomains)
  // VS Code / GitHub Copilot
  'http://127.0.0.1:33418',
  'https://vscode.dev/redirect',
  // For local development/testing (MCP Inspector, etc.)
  'http://localhost:3000/oauth/callback',
  'http://localhost:6274/oauth/callback',
];

// Check if a redirect URI is a valid loopback callback (RFC 8252).
// Accepts dynamic ports on localhost/127.0.0.1 with known callback paths.
// Covers: Claude Code, Gemini CLI, Windsurf, and other MCP CLI/desktop clients.
const ALLOWED_LOOPBACK_PATHS = new Set([
  '/callback',              // Claude Code
  '/oauth/callback',        // Claude Code (alt), MCP Inspector
  '/oauth2callback',        // Gemini CLI
  '/windsurf-auth-callback', // Windsurf
]);

function isLoopbackRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    // Check for http scheme (required for loopback)
    if (parsed.protocol !== 'http:') return false;
    // Check for loopback hostname
    const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    // Check path against known callback paths
    const isCallback = ALLOWED_LOOPBACK_PATHS.has(parsed.pathname);
    // Reject URIs with query strings or fragments (prevent open redirect)
    const isClean = !parsed.search && !parsed.hash;
    return isLoopback && isCallback && isClean;
  } catch {
    return false;
  }
}

// ChatGPT Actions/connectors generate dynamic per-app callback paths
function isChatGptConnectorUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'chatgpt.com' &&
      parsed.pathname.startsWith('/connector/oauth/') &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

// Perplexity uses multiple domains/subdomains (www.perplexity.ai, www.perplexity.com,
// enterprise.perplexity.ai, etc.) — match any *.perplexity.{ai,com} with the known path.
function isPerplexityRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname;
    const isPerplexity =
      (host === 'perplexity.ai' || host.endsWith('.perplexity.ai') ||
       host === 'perplexity.com' || host.endsWith('.perplexity.com'));
    const isCallbackPath = parsed.pathname === '/rest/connections/oauth_callback';
    return isPerplexity && isCallbackPath && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

// Cursor IDE uses cursor:// custom URI scheme for MCP OAuth
// Pattern: cursor://anysphere.cursor-mcp/oauth/{id}/callback
function isCursorRedirectUri(uri: string): boolean {
  try {
    // URL constructor doesn't handle custom schemes well, so parse manually
    if (!uri.startsWith('cursor://')) return false;
    const withoutScheme = uri.slice('cursor://'.length);
    // Must start with known Cursor host prefix
    if (!withoutScheme.startsWith('anysphere.cursor-')) return false;
    // Must end with /callback and contain /oauth/
    if (!withoutScheme.includes('/oauth/') || !withoutScheme.endsWith('/callback')) return false;
    // Reject query strings or fragments
    if (uri.includes('?') || uri.includes('#')) return false;
    return true;
  } catch {
    return false;
  }
}

export function isValidRedirectUri(uri: string): boolean {
  // Exact match against static allowlist
  if (ALLOWED_REDIRECT_URIS.includes(uri)) return true;

  // ChatGPT dev-mode apps generate unique per-app callback paths
  if (isChatGptConnectorUri(uri)) return true;

  // Perplexity uses multiple domains (www.perplexity.ai, www.perplexity.com, enterprise.perplexity.ai, etc.)
  if (isPerplexityRedirectUri(uri)) return true;

  // Cursor IDE uses a custom URI scheme
  if (isCursorRedirectUri(uri)) return true;

  // Dynamic loopback URIs for CLI/desktop apps (RFC 8252)
  return isLoopbackRedirectUri(uri);
}
