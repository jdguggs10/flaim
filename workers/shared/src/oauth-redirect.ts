/**
 * OAuth redirect URI validation — shared across auth-worker and web.
 * Browser-safe: URL, Set, string ops only — zero imports.
 * RFC 9700: exact-match + locked structural checks.
 * RFC 8252: dynamic loopback port and path acceptance.
 */

const ALLOWED_REDIRECT_URIS = [
  // Claude.ai web + Claude Desktop (both route through claude.ai)
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  // ChatGPT MCP connectors (dynamic per-app paths matched below)
  'https://chatgpt.com/connector_platform_oauth_redirect',
  'https://platform.openai.com/apps-manage/oauth',
  // Grok custom connectors (exact hosted callback observed during registration)
  'https://grok.com/connectors-oauth-exchange-code/',
  // Cursor web + Cloud/Background Agents (fixed callback per Cursor's MCP docs,
  // distinct from the cursor:// desktop-IDE scheme handled by isCursorRedirectUri)
  'https://www.cursor.com/agents/mcp/oauth/callback',
  // Perplexity custom connectors (pattern matched below for all subdomains)
  // Littlebird custom connectors (exact production callback)
  'https://app.lilbird.co/mcp/oauth/callback',
  // User-hosted relay (exact callback only, not other Render services)
  'https://flaim-relay.onrender.com/oauth/callback',
  // VS Code web (desktop VS Code's 127.0.0.1:33418 callback is covered by
  // the general loopback rule below, same as any other loopback client)
  'https://vscode.dev/redirect',
];

// Check if a redirect URI is a valid loopback callback (RFC 8252 §7.3).
// Accepts any port and any path on localhost/127.0.0.1/::1 — the port is
// inherently dynamic for native/desktop clients, and a fixed callback-path
// allowlist doesn't add real security here: DCR already lets any client
// self-register any redirect_uri it wants, so the actual boundary is "must
// be reachable only via loopback" plus PKCE, not the specific path chosen.
function isLoopbackRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    // Check for http scheme (required for loopback)
    if (parsed.protocol !== 'http:') return false;
    // Check for loopback hostname (IPv6 loopback serializes as "[::1]")
    const isLoopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]';
    // Reject URIs with query strings or fragments (prevent open redirect)
    const isClean = !parsed.search && !parsed.hash;
    return isLoopback && isClean;
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

// Gemini Spark custom apps register production, test, and sandbox callbacks
// together. Each host uses both /r/ and /a/ paths with the same user-bound
// numeric identifier and a suffix derived from Flaim's production host. Match the raw URI so normalization cannot hide
// alternate ports, dot segments, encoded path separators, or other structural
// differences.
function isGeminiSparkRedirectUri(uri: string): boolean {
  return /^https:\/\/(?:oauth-redirect-sandbox|oauth-redirect-test|oauth-redirect)\.googleusercontent\.com\/(?:r|a)\/user_bound_custom-mcp-[0-9]+-api_flaim_app(?![\s\S])/.test(uri);
}

// Cursor IDE uses cursor:// custom URI scheme for MCP OAuth
// Pattern: cursor://anysphere.cursor-mcp/oauth/{id}/callback
// Uses string operations only — URL constructor does not handle custom schemes.
function isCursorRedirectUri(uri: string): boolean {
  if (!uri.startsWith('cursor://')) return false;
  const withoutScheme = uri.slice('cursor://'.length);
  if (!withoutScheme.startsWith('anysphere.cursor-')) return false;
  if (!withoutScheme.includes('/oauth/') || !withoutScheme.endsWith('/callback')) return false;
  if (uri.includes('?') || uri.includes('#')) return false;
  return true;
}

export function isValidRedirectUri(uri: string): boolean {
  // Exact match against static allowlist
  if (ALLOWED_REDIRECT_URIS.includes(uri)) return true;

  // ChatGPT dev-mode apps generate unique per-app callback paths
  if (isChatGptConnectorUri(uri)) return true;

  // Perplexity uses multiple domains (www.perplexity.ai, www.perplexity.com, enterprise.perplexity.ai, etc.)
  if (isPerplexityRedirectUri(uri)) return true;

  // Gemini Spark custom apps use six user-bound callbacks on three exact Google hosts
  if (isGeminiSparkRedirectUri(uri)) return true;

  // Cursor IDE uses a custom URI scheme
  if (isCursorRedirectUri(uri)) return true;

  // Dynamic loopback URIs for CLI/desktop apps (RFC 8252)
  return isLoopbackRedirectUri(uri);
}
