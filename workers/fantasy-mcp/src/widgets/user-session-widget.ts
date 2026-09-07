// workers/fantasy-mcp/src/widgets/user-session-widget.ts

/**
 * Self-contained HTML widget for the get_user_session tool.
 * Renders the user's fantasy leagues inline through the MCP Apps bridge, with
 * ChatGPT window.openai compatibility as a fallback.
 *
 * Design constraints:
 * - No external scripts, fonts, images, or stylesheets (CSP-safe for iframe sandbox)
 * - 353px maximum width, shrinking to its container (ChatGPT text response template)
 * - System fonts only
 * - Light and dark palettes, driven by window.openai.theme with a
 *   prefers-color-scheme fallback
 * - Aligns with flaim.app branding
 *
 * Data access - in order of priority:
 * 1. MCP Apps postMessage JSON-RPC ui/notifications/tool-result
 * 2. openai:set_globals CustomEvent -> window.openai.toolOutput
 * 3. window.openai.toolOutput on immediate/DOMContentLoaded (may already be set)
 * 4. window.openai.callTool refresh button for manual league discovery refresh
 *
 * References:
 * - https://developers.openai.com/apps-sdk/build/chatgpt-ui/
 * - https://developers.openai.com/apps-sdk/build/mcp-server/
 */
/**
 * Versioning rule:
 *
 * A published widget URI's *resource metadata* is frozen. OpenAI snapshots the
 * read-result `_meta` (`ui.csp`, `openai/widgetDescription`, and
 * `openai/widgetCSP`) at review time, so those blocks must stay byte-identical
 * per URI in `../mcp/server.ts`.
 *
 * The *body* served at a published URI may change, as long as the change stays
 * within the metadata that URI already declares. Backward-compatible content
 * updates at an already-published resource URI do not require resubmission;
 * cached client copies pick the new body up on their own. A new URI is only
 * needed when the body would require metadata the published URI does not
 * declare — for example a new redirect, connect, or resource domain.
 *
 * That is why there are exactly two bodies for three URIs. v1 and v2 declare
 * only https://flaim.app as a redirect domain, so their body names the data
 * providers as plain text. v3 additionally declares https://sports.yahoo.com,
 * so its body links "Yahoo Fantasy" to the official Yahoo Fantasy site.
 */
export const LEGACY_USER_SESSION_WIDGET_URI = 'ui://widget/user-session.html';
export const V2_USER_SESSION_WIDGET_URI = 'ui://widget/user-session-v2.html';
export const USER_SESSION_WIDGET_URI = 'ui://widget/user-session-v3.html';

export type RefreshResultKind =
  | 'success'
  | 'unchanged'
  | 'partial'
  | 'retry'
  | 'reconnect'
  | 'failure';

export interface RefreshResultClassification {
  kind: RefreshResultKind;
  message: string;
  reloadSession: boolean;
  showLeaguesLink?: boolean;
}

/** Classify the auth-worker batch response without trusting aggregate success alone. */
export function classifyRefreshResult(payload: unknown): RefreshResultClassification {
  const fallback = { kind: 'failure', message: 'Refresh failed.', reloadSession: false } as const;
  if (!payload || typeof payload !== 'object') return fallback;

  const batch = payload as Record<string, unknown>;
  if (batch.status === 429) {
    return { kind: 'retry', message: 'Refresh limited. Try again later.', reloadSession: false };
  }
  const rawResults = batch.results;
  if (!rawResults || typeof rawResults !== 'object' || Array.isArray(rawResults)) return fallback;

  const results = Object.values(rawResults as Record<string, unknown>).filter(
    (value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value),
  );
  if (results.length === 0) return fallback;

  const successes = results.filter((result) => result.status === 'success');
  const skipped = results.filter((result) => result.status === 'skipped');
  const failed = results.filter((result) => result.status === 'error');
  const textFor = (result: Record<string, unknown>) =>
    `${String(result.error || '')} ${String(result.error_description || '')}`.toLowerCase();
  const explicitlyRequiresReconnect = results.some((result) =>
    result.reconnectRequired === true || result.requiresReconnect === true || result.reconnect_required === true,
  );
  const reconnectRequired = explicitlyRequiresReconnect || failed.some((result) => {
    const text = textFor(result);
    return result.httpStatus === 401 || result.httpStatus === 403 ||
      /auth|credential|connect|expired|invalid.token|revoked/.test(text);
  });
  const retryRequired = failed.some((result) => {
    const text = textFor(result);
    return result.httpStatus === 429 || !!result.retryAfter || /rate.?limit|too many|try again/.test(text);
  });

  if (successes.length > 0) {
    // A successful provider result is not enough: the batch contract must also
    // explicitly confirm success before the widget reports a positive outcome.
    if (batch.success !== true) return fallback;
    const changeKeys = new Set(['added', 'refreshed', 'created', 'updated', 'saved']);
    let changed = false;
    const inspectCounts = (value: unknown): boolean => {
      let sawChangeCount = false;
      if (!value || typeof value !== 'object') return false;
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (changeKeys.has(key) && typeof nested === 'number') {
          sawChangeCount = true;
          if (nested > 0) changed = true;
        } else if (typeof nested === 'object') {
          sawChangeCount = inspectCounts(nested) || sawChangeCount;
        }
      }
      return sawChangeCount;
    };
    let allSuccessesHaveChangeCounts = true;
    successes.forEach((result) => {
      if (result.platform !== 'espn' || !inspectCounts(result.details)) {
        allSuccessesHaveChangeCounts = false;
      }
    });

    if (failed.length > 0 || explicitlyRequiresReconnect) {
      const partialMessage = changed ? 'Some leagues refreshed.' : 'Refresh partially complete.';
      return {
        kind: 'partial',
        message: reconnectRequired
          ? `${partialMessage} Reconnect a provider.`
          : retryRequired
            ? `${partialMessage} Try again later.`
            : partialMessage,
        reloadSession: true,
        ...(reconnectRequired ? { showLeaguesLink: true } : {}),
      };
    }

    if (changed) {
      return { kind: 'success', message: 'Leagues refreshed.', reloadSession: true };
    }
    if (!allSuccessesHaveChangeCounts) {
      return { kind: 'success', message: 'Refresh complete.', reloadSession: true };
    }
    return { kind: 'unchanged', message: 'Leagues already up to date.', reloadSession: true };
  }

  if (reconnectRequired) {
    return { kind: 'reconnect', message: 'Reconnect a league provider.', reloadSession: false };
  }
  if (retryRequired) {
    return { kind: 'retry', message: 'Refresh limited. Try again later.', reloadSession: false };
  }
  if (skipped.length === results.length) {
    return { kind: 'unchanged', message: 'No connected leagues to refresh.', reloadSession: false };
  }
  return fallback;
}

/**
 * Provider attribution: surfaces that display Yahoo Fantasy data credit
 * "Fantasy data provided by Yahoo Fantasy". The credit is linked only where
 * the URI's published widget CSP allows https://sports.yahoo.com as a redirect
 * domain. ESPN and Sleeper are named voluntarily so the three providers read
 * consistently; they stay plain text on every URI because no published widget
 * CSP allows their domains.
 */
const YAHOO_ATTRIBUTION_PLAIN = 'Yahoo Fantasy';
const YAHOO_ATTRIBUTION_LINKED =
  '<a class="credit" href="https://sports.yahoo.com/fantasy/" target="_blank" rel="noopener noreferrer" id="yahoo-link">Yahoo Fantasy</a>';

/**
 * Inline SVG paths from Tabler Icons v3.41.1 (MIT), copyright Paweł Kuna.
 * The widget stays self-contained, so it needs no resource-domain allowance.
 */
const TABLER_LICENSE_HTML = `<!--
Tabler Icons v3.41.1
Copyright (c) 2020-2026 Paweł Kuna

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
-->`;

export interface UserSessionWidgetOptions {
  /**
   * Link the Yahoo Fantasy credit to the official Yahoo Fantasy site. Only
   * enable this for a URI whose published widget CSP allows
   * https://sports.yahoo.com as a redirect domain.
   */
  linkYahoo: boolean;
}

/**
 * Build the widget document. The two variants differ by exactly one substring:
 * the Yahoo Fantasy credit is either plain text or a link.
 */
export function buildUserSessionWidgetHtml(options: UserSessionWidgetOptions): string {
  const yahooCredit = options.linkYahoo ? YAHOO_ATTRIBUTION_LINKED : YAHOO_ATTRIBUTION_PLAIN;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Flaim</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    color-scheme: light;
    --fg: #171717;
    --bg: #ffffff;
    --border: #e5e5e5;
    --divider: #ededed;
    --muted: #626262;
    --hover: #f2f2f2;
    --focus: #626262;
    --band-bg: #f3f4f5;
    --band-fg: #555555;
    --row-line: #eeeeee;
    --detail: #656565;
    --gold: #dfc477;
    --badge-default-bg: #faf0d2;
    --badge-default-fg: #7b6223;
    --badge-espn-bg: #fbeef0;
    --badge-espn-fg: #a52c40;
    --badge-yahoo-bg: #f4edf8;
    --badge-yahoo-fg: #733491;
    --badge-sleeper-bg: #edf5ef;
    --badge-sleeper-fg: #34674a;
    --footer-line: #ececec;
    --footer-fg: #777777;
    --credit-hover: #353535;
    --status-fg: #47664f;
    --status-error-fg: #b3261e;
  }
  @media (prefers-color-scheme: dark) {
    html:not(.theme-light) {
      color-scheme: dark;
      --fg: #ededed;
      --bg: #202020;
      --border: #404040;
      --divider: #363636;
      --muted: #b7b7b7;
      --hover: #343434;
      --focus: #cccccc;
      --band-bg: #2b2c2e;
      --band-fg: #c2c2c2;
      --row-line: #373737;
      --detail: #b4b4b4;
      --gold: #9a8142;
      --badge-default-bg: #42391f;
      --badge-default-fg: #ecd18b;
      --badge-espn-bg: #44262d;
      --badge-espn-fg: #ffb4c1;
      --badge-yahoo-bg: #392741;
      --badge-yahoo-fg: #dab4f1;
      --badge-sleeper-bg: #253b2c;
      --badge-sleeper-fg: #a4dfbb;
      --footer-line: #363636;
      --footer-fg: #a8a8a8;
      --credit-hover: #e0e0e0;
      --status-fg: #b7d7bf;
      --status-error-fg: #f2b8b5;
    }
  }
  html.theme-light { color-scheme: light; }
  /* Same values as the dark media block above. The host theme global sets
     this class to override the OS preference; keep both copies in sync. */
  html.theme-dark {
    color-scheme: dark;
    --fg: #ededed;
    --bg: #202020;
    --border: #404040;
    --divider: #363636;
    --muted: #b7b7b7;
    --hover: #343434;
    --focus: #cccccc;
    --band-bg: #2b2c2e;
    --band-fg: #c2c2c2;
    --row-line: #373737;
    --detail: #b4b4b4;
    --gold: #9a8142;
    --badge-default-bg: #42391f;
    --badge-default-fg: #ecd18b;
    --badge-espn-bg: #44262d;
    --badge-espn-fg: #ffb4c1;
    --badge-yahoo-bg: #392741;
    --badge-yahoo-fg: #dab4f1;
    --badge-sleeper-bg: #253b2c;
    --badge-sleeper-fg: #a4dfbb;
    --footer-line: #363636;
    --footer-fg: #a8a8a8;
    --credit-hover: #e0e0e0;
    --status-fg: #b7d7bf;
    --status-error-fg: #f2b8b5;
  }
  html,
  body {
    width: 100%;
    max-width: 353px;
    overflow-x: hidden;
    background: transparent;
  }
  body {
    font-family: "Geist", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: var(--fg);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }
  a:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .widget {
    position: relative;
    width: 100%;
    max-width: 353px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 24px;
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px 6px 16px;
    border-bottom: 1px solid var(--divider);
  }
  .app-name {
    font-size: 17px;
    line-height: 24px;
    font-weight: 500;
    letter-spacing: -0.4px;
  }
  .edit-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    color: inherit;
    text-decoration: none;
  }
  .edit-link:hover { background: var(--hover); }
  .edit-link svg {
    width: 18px;
    height: 18px;
  }
  .sport-group + .sport-group { margin-top: 12px; }
  .sport-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 16px;
    background: var(--band-bg);
    color: var(--band-fg);
    font-size: 13px;
    line-height: 22px;
    font-weight: 500;
  }
  .sport-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .sport-icon {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    height: 22px;
    padding: 3px 7px;
    border-radius: 5px;
    font-size: 11px;
    line-height: 16px;
    font-weight: 500;
    letter-spacing: 0.15px;
    text-transform: uppercase;
  }
  .badge-default {
    background: var(--badge-default-bg);
    color: var(--badge-default-fg);
  }
  .badge-espn { width: 60px; background: var(--badge-espn-bg); color: var(--badge-espn-fg); }
  .badge-yahoo { width: 60px; background: var(--badge-yahoo-bg); color: var(--badge-yahoo-fg); }
  .badge-sleeper { width: 60px; background: var(--badge-sleeper-bg); color: var(--badge-sleeper-fg); }
  .league-list { list-style: none; }
  .league-row {
    position: relative;
    height: 60px;
    min-width: 0;
    padding: 9px 16px;
    display: grid;
    grid-template-columns: 60px minmax(0, 1fr);
    align-items: center;
    column-gap: 10px;
  }
  .league-row:not(:last-child)::before {
    content: "";
    position: absolute;
    bottom: 0;
    left: 86px;
    right: 16px;
    height: 1px;
    background: var(--row-line);
  }
  .league-row.is-default::after {
    content: "";
    position: absolute;
    right: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 3px 0 0 3px;
    background: var(--gold);
  }
  .copy { min-width: 0; }
  .league-name {
    font-size: 15px;
    line-height: 20px;
    letter-spacing: -0.25px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .league-detail {
    display: flex;
    align-items: baseline;
    gap: 5px;
    margin-top: 3px;
    min-width: 0;
    font-size: 12px;
    line-height: 18px;
    color: var(--detail);
  }
  .league-year {
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .league-team {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty-state {
    padding: 24px 16px;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }
  .empty-state a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 32px;
    margin-top: 12px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: inherit;
    font-weight: 500;
    text-decoration: none;
  }
  .empty-state a:hover { background: var(--hover); }
  .loading {
    padding: 24px 16px;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }
  .footer {
    padding: 10px 16px 12px;
    border-top: 1px solid var(--footer-line);
    text-align: center;
    font-size: 11px;
    line-height: 16px;
    color: var(--footer-fg);
  }
  .refresh {
    display: inline;
    padding: 0;
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .refresh:disabled { cursor: wait; }
  .refresh-word,
  .credit {
    color: inherit;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }
  .refresh:hover .refresh-word,
  .credit:hover { color: var(--credit-hover); }
  .status {
    margin-top: 8px;
    font-size: 12px;
    line-height: 18px;
    color: var(--status-fg);
  }
  .status:empty { margin-top: 0; }
  .status.is-error { color: var(--status-error-fg); }
  .status a { color: inherit; text-decoration: underline; }
  @media (pointer: coarse) {
    .header { padding-top: 0; padding-bottom: 0; }
    .edit-link { width: 44px; height: 44px; }
  }
</style>
</head>
<body>
<div class="widget">
  <header class="header">
    <span class="app-name">Your Leagues</span>
    <a href="https://flaim.app/leagues?from=widget" target="_blank" rel="noopener" class="edit-link" aria-label="Edit leagues" title="Edit leagues" id="edit-link">
      <svg class="edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
        <path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1"></path>
        <path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z"></path>
        <path d="M16 5l3 3"></path>
      </svg>
    </a>
  </header>
  <div id="content">
    <div class="loading">Loading&hellip;</div>
  </div>
  <footer class="footer">
    <button type="button" class="refresh" id="refresh-button"><span class="refresh-word" id="refresh-word">Refresh</span> your leagues, seasons, and team names.</button> Fantasy data provided by ${yahooCredit}, ESPN, and Sleeper.
    <div class="status" id="refresh-status" role="status" aria-live="polite"></div>
  </footer>
</div>
<script>
(function() {
  var VALID_PLATFORMS = { espn: true, yahoo: true, sleeper: true };
  var SPORT_ORDER = { baseball: 0, football: 1, basketball: 2, hockey: 3 };
  var SPORT_LABELS = { baseball: 'Baseball', football: 'Football', basketball: 'Basketball', hockey: 'Hockey' };
  var SPORT_ICON_PATHS = {
    football: '<path d="M15 9l-6 6"></path><path d="M10 12l2 2"></path><path d="M12 10l2 2"></path><path d="M8 21a5 5 0 0 0 -5 -5"></path><path d="M16 3c-7.18 0 -13 5.82 -13 13a5 5 0 0 0 5 5c7.18 0 13 -5.82 13 -13a5 5 0 0 0 -5 -5"></path><path d="M16 3a5 5 0 0 0 5 5"></path>',
    baseball: '<path d="M5.636 18.364a9 9 0 1 0 12.728 -12.728a9 9 0 0 0 -12.728 12.728"></path><path d="M12.495 3.02a9 9 0 0 1 -9.475 9.475"></path><path d="M20.98 11.505a9 9 0 0 0 -9.475 9.475"></path><path d="M9 9l2 2"></path><path d="M13 13l2 2"></path><path d="M11 7l2 1"></path><path d="M7 11l1 2"></path><path d="M16 11l1 2"></path><path d="M11 16l2 1"></path>',
    basketball: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path><path d="M5.65 5.65l12.7 12.7"></path><path d="M5.65 18.35l12.7 -12.7"></path><path d="M12 3a9 9 0 0 0 9 9"></path><path d="M3 12a9 9 0 0 1 9 9"></path>',
    hockey: '<path d="M5.905 5h3.418a1 1 0 0 1 .928 .629l1.143 2.856a3 3 0 0 0 2.207 1.83l4.717 .926a2.084 2.084 0 0 1 1.682 2.045v.714a1 1 0 0 1 -1 1h-13.895a1 1 0 0 1 -1 -1.1l.8 -8a1 1 0 0 1 1 -.9"></path><path d="M3 19h17a1 1 0 0 0 1 -1"></path><path d="M9 15v4"></path><path d="M15 15v4"></path>',
    other: '<path d="M8 21l8 0"></path><path d="M12 17l0 4"></path><path d="M7 4l10 0"></path><path d="M17 4v8a5 5 0 0 1 -10 0v-8"></path><path d="M3 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path><path d="M17 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path>'
  };
  var LEAGUES_URL = 'https://flaim.app/leagues?from=widget';
  var WIDGET_WIDTH = 353;
  var initId = 'flaim-init-' + Math.random().toString(36).slice(2);
  var initializedSent = false;
  var hasRendered = false;
  // Keep this browser implementation static. Serializing the module function
  // can leak Wrangler-generated module helpers into the iframe.
  function classifyRefreshResult(payload) {
    var fallback = { kind: 'failure', message: 'Refresh failed.', reloadSession: false };
    if (!payload || typeof payload !== 'object') return fallback;

    var batch = payload;
    if (batch.status === 429) {
      return { kind: 'retry', message: 'Refresh limited. Try again later.', reloadSession: false };
    }
    var rawResults = batch.results;
    if (!rawResults || typeof rawResults !== 'object' || Array.isArray(rawResults)) return fallback;

    var results = Object.values(rawResults).filter(function(value) {
      return !!value && typeof value === 'object' && !Array.isArray(value);
    });
    if (results.length === 0) return fallback;

    var successes = results.filter(function(result) { return result.status === 'success'; });
    var skipped = results.filter(function(result) { return result.status === 'skipped'; });
    var failed = results.filter(function(result) { return result.status === 'error'; });
    function textFor(result) {
      return (String(result.error || '') + ' ' + String(result.error_description || '')).toLowerCase();
    }
    var explicitlyRequiresReconnect = results.some(function(result) {
      return result.reconnectRequired === true || result.requiresReconnect === true || result.reconnect_required === true;
    });
    var reconnectRequired = explicitlyRequiresReconnect || failed.some(function(result) {
      var text = textFor(result);
      return result.httpStatus === 401 || result.httpStatus === 403 ||
        /auth|credential|connect|expired|invalid.token|revoked/.test(text);
    });
    var retryRequired = failed.some(function(result) {
      var text = textFor(result);
      return result.httpStatus === 429 || !!result.retryAfter || /rate.?limit|too many|try again/.test(text);
    });

    if (successes.length > 0) {
      if (batch.success !== true) return fallback;
      var changeKeys = new Set(['added', 'refreshed', 'created', 'updated', 'saved']);
      var changed = false;
      function inspectCounts(value) {
        var sawChangeCount = false;
        if (!value || typeof value !== 'object') return false;
        Object.entries(value).forEach(function(entry) {
          var key = entry[0];
          var nested = entry[1];
          if (changeKeys.has(key) && typeof nested === 'number') {
            sawChangeCount = true;
            if (nested > 0) changed = true;
          } else if (typeof nested === 'object') {
            sawChangeCount = inspectCounts(nested) || sawChangeCount;
          }
        });
        return sawChangeCount;
      }
      var allSuccessesHaveChangeCounts = true;
      successes.forEach(function(result) {
        if (result.platform !== 'espn' || !inspectCounts(result.details)) {
          allSuccessesHaveChangeCounts = false;
        }
      });

      if (failed.length > 0 || explicitlyRequiresReconnect) {
        var partialMessage = changed ? 'Some leagues refreshed.' : 'Refresh partially complete.';
        var message = reconnectRequired
          ? partialMessage + ' Reconnect a provider.'
          : retryRequired
            ? partialMessage + ' Try again later.'
            : partialMessage;
        var partial = { kind: 'partial', message: message, reloadSession: true };
        if (reconnectRequired) partial.showLeaguesLink = true;
        return partial;
      }

      if (changed) {
        return { kind: 'success', message: 'Leagues refreshed.', reloadSession: true };
      }
      if (!allSuccessesHaveChangeCounts) {
        return { kind: 'success', message: 'Refresh complete.', reloadSession: true };
      }
      return { kind: 'unchanged', message: 'Leagues already up to date.', reloadSession: true };
    }

    if (reconnectRequired) {
      return { kind: 'reconnect', message: 'Reconnect a league provider.', reloadSession: false };
    }
    if (retryRequired) {
      return { kind: 'retry', message: 'Refresh limited. Try again later.', reloadSession: false };
    }
    if (skipped.length === results.length) {
      return { kind: 'unchanged', message: 'No connected leagues to refresh.', reloadSession: false };
    }
    return fallback;
  }

  function postToParent(message) {
    try {
      if (window.parent && window.parent !== window) {
        // Sandboxed MCP Apps hosts do not always expose a stable target origin.
        // These lifecycle messages contain no secrets, so '*' is intentional.
        window.parent.postMessage(message, '*');
      }
    } catch (_) {}
  }

  function isTrustedMessageEvent(event) {
    if (!event.source || !window.parent || event.source !== window.parent) return false;
    // Claude Desktop and other sandboxed MCP Apps hosts can emit "null"
    // origins. Accept them only after the parent-frame source check above.
    if (!event.origin || event.origin === 'null') return true;
    try {
      var url = new URL(event.origin);
      var host = url.hostname;
      if (url.protocol !== 'https:') return false;
      // Extend this allowlist when a new MCP Apps host origin is certified.
      return host === 'chatgpt.com' ||
        host === 'chat.openai.com' ||
        host === 'claude.ai' ||
        host.endsWith('.claude.ai') ||
        host.endsWith('.claudemcpcontent.com') ||
        host.endsWith('.oaiusercontent.com');
    } catch (_) {
      return false;
    }
  }

  function sendInitialized() {
    if (initializedSent) return;
    initializedSent = true;
    postToParent({
      jsonrpc: '2.0',
      method: 'ui/notifications/initialized',
      params: {},
    });
  }

  function startMcpAppsLifecycle() {
    postToParent({
      jsonrpc: '2.0',
      id: initId,
      method: 'ui/initialize',
      params: {
        protocolVersion: '2026-01-26',
        appInfo: {
          name: 'Flaim',
          version: '1.0.0',
        },
        appCapabilities: {},
      },
    });
  }

  function sendSizeChanged() {
    var widget = document.querySelector('.widget');
    var rect = widget && widget.getBoundingClientRect ? widget.getBoundingClientRect() : null;
    postToParent({
      jsonrpc: '2.0',
      method: 'ui/notifications/size-changed',
      params: {
        width: rect && rect.width ? Math.ceil(rect.width) : WIDGET_WIDTH,
        height: rect && rect.height ? Math.ceil(rect.height) : document.body.scrollHeight || 0,
      },
    });
  }

  function queueSizeChanged() {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(sendSizeChanged);
      return;
    }
    setTimeout(sendSizeChanged, 0);
  }

  // Theme: prefer the host global when it exposes one, otherwise leave the
  // document on its prefers-color-scheme fallback.
  function readHostTheme() {
    try {
      if (window.openai && window.openai.theme !== undefined) return window.openai.theme;
    } catch (_) {}
    return null;
  }

  function applyTheme(value) {
    var root = document.documentElement;
    if (!root || !root.classList) return;
    var theme = value === 'dark' ? 'dark' : (value === 'light' ? 'light' : null);
    root.classList.remove('theme-dark');
    root.classList.remove('theme-light');
    if (theme) root.classList.add('theme-' + theme);
  }

  function openNewTab(url) {
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (_) {}
  }

  function openFallbackUrl(url) {
    try {
      if (window.openai && typeof window.openai.openUrl === 'function') {
        window.openai.openUrl(url);
        return false;
      }
    } catch (_) {}
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      return false;
    } catch (_) {}
    try {
      window.location.href = url;
    } catch (_) {}
    return false;
  }

  function openExternalUrl(url) {
    try {
      if (window.openai && typeof window.openai.openExternal === 'function') {
        var result = window.openai.openExternal({ href: url });
        if (result && typeof result.catch === 'function') {
          // A resolved promise only tells us the host accepted the request;
          // rejection is the only observable signal where fallback is useful.
          result.catch(function() { openFallbackUrl(url); });
        }
        if (result === false) return openFallbackUrl(url);
        return false;
      }
    } catch (_) {}
    return openFallbackUrl(url);
  }

  function openLeagues(e) {
    if (e && e.preventDefault) e.preventDefault();
    return openExternalUrl(LEAGUES_URL);
  }

  function setRefreshStatus(message, kind) {
    var status = document.getElementById('refresh-status');
    if (!status) return;
    status.className = 'status' + (kind ? ' is-' + kind : '');
    status.innerHTML = message || '';
    queueSizeChanged();
  }

  function setRefreshLoading(isLoading) {
    var button = document.getElementById('refresh-button');
    if (button) button.disabled = !!isLoading;
    var word = document.getElementById('refresh-word');
    if (word) word.textContent = isLoading ? 'Refreshing' : 'Refresh';
  }

  function render(data) {
    var container = document.getElementById('content');
    if (!container) return;
    if (!data || !data.allLeagues || data.allLeagues.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        'Flaim is connected, but no fantasy leagues are set up yet.<br />' +
        '<a href="' + LEAGUES_URL + '" target="_blank" rel="noopener" id="connect-league-link">Open My Leagues</a>' +
        '</div>';
      var connectLeagueLink = document.getElementById('connect-league-link');
      if (connectLeagueLink) connectLeagueLink.addEventListener('click', openLeagues);
      hasRendered = true;
      queueSizeChanged();
      return;
    }

    var leagues = data.allLeagues;

    var defaultKeys = Object.create(null);
    if (data.defaultLeagues) {
      Object.keys(data.defaultLeagues).forEach(function(sport) {
        var dl = data.defaultLeagues[sport];
        if (dl) defaultKeys[dl.platform + ':' + dl.leagueId + ':' + dl.seasonYear] = true;
      });
    }

    var defaultSport = data.defaultSport || null;

    var groups = Object.create(null);
    var order = [];
    leagues.forEach(function(league) {
      var sport = String(league.sport || 'other').toLowerCase();
      if (!groups[sport]) {
        groups[sport] = [];
        order.push(sport);
      }
      groups[sport].push(league);
    });

    order.sort(function(a, b) {
      // Default sport always sorts first
      if (a === defaultSport && b !== defaultSport) return -1;
      if (b === defaultSport && a !== defaultSport) return 1;
      var oa = Object.prototype.hasOwnProperty.call(SPORT_ORDER, a) ? SPORT_ORDER[a] : 99;
      var ob = Object.prototype.hasOwnProperty.call(SPORT_ORDER, b) ? SPORT_ORDER[b] : 99;
      return oa - ob;
    });

    var html = '';
    order.forEach(function(sport) {
      var label = formatSportLabel(sport);
      html += '<section class="sport-group">';
      html += '<h2 class="sport-header">';
      html += '<span class="sport-label">' + renderSportIcon(sport) + '<span>' + esc(label) + '</span></span>';
      if (sport === defaultSport) {
        // The badge is decorative; the hidden text carries the same meaning
        // for assistive technology.
        html += '<span class="badge badge-default" aria-hidden="true">DEFAULT</span>';
        html += '<span class="visually-hidden">Default sport</span>';
      }
      html += '</h2>';
      html += '<ul class="league-list">';
      groups[sport].forEach(function(league) {
        var key = league.platform + ':' + league.leagueId + ':' + league.seasonYear;
        var isDefault = Object.prototype.hasOwnProperty.call(defaultKeys, key);
        var platform = Object.prototype.hasOwnProperty.call(VALID_PLATFORMS, league.platform) ? league.platform : 'espn';
        var name = String(league.leagueName || league.leagueId || '');
        var team = league.teamName ? String(league.teamName) : '';
        var year = league.seasonYear ? String(league.seasonYear) : '';
        // Truncated names stay available in full to assistive technology, and
        // the gold default edge gets a text equivalent here.
        var providerLabel = platform === 'espn' ? 'ESPN' : platform === 'yahoo' ? 'Yahoo' : 'Sleeper';
        if (league.platform !== platform) providerLabel = String(league.platform || '');
        var described = [name];
        if (providerLabel) described.push(providerLabel);
        if (year) described.push(year);
        if (team) described.push(team);
        if (isDefault) described.push('default ' + label.toLowerCase() + ' league');
        html += '<li class="league-row' + (isDefault ? ' is-default' : '') + '" aria-label="' + escAttr(described.join(', ')) + '">';
        html += '<span class="badge badge-' + platform + '">' + esc(league.platform || '') + '</span>';
        html += '<div class="copy">';
        html += '<div class="league-name" title="' + escAttr(name) + '">' + esc(name) + '</div>';
        if (year || team) {
          html += '<div class="league-detail">';
          if (year) html += '<span class="league-year">' + esc(year) + '</span>';
          if (year && team) html += '<span aria-hidden="true">·</span>';
          if (team) html += '<span class="league-team" title="' + escAttr(team) + '">' + esc(team) + '</span>';
          html += '</div>';
        }
        html += '</div></li>';
      });
      html += '</ul></section>';
    });

    container.innerHTML = html;
    hasRendered = true;
    queueSizeChanged();
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatSportLabel(sport) {
    var key = String(sport || 'other').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(SPORT_LABELS, key)) return SPORT_LABELS[key];
    var label = String(sport || 'Other');
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function renderSportIcon(sport) {
    var key = String(sport || 'other').toLowerCase();
    var paths = Object.prototype.hasOwnProperty.call(SPORT_ICON_PATHS, key)
      ? SPORT_ICON_PATHS[key]
      : SPORT_ICON_PATHS.other;
    return '<svg class="sport-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + paths + '</svg>';
  }

  var editLink = document.getElementById('edit-link');
  if (editLink) editLink.addEventListener('click', openLeagues);
  var refreshButton = document.getElementById('refresh-button');
  if (refreshButton) refreshButton.addEventListener('click', refreshLeagues);
  // Present only on bodies whose published widget CSP allows the Yahoo
  // redirect domain. The href is read from the anchor so no other body carries
  // an external URL.
  var yahooLink = document.getElementById('yahoo-link');
  if (yahooLink) {
    yahooLink.addEventListener('click', function(e) {
      // Only intercept where the host exposes openExternal. Everywhere else
      // (Claude, other MCP Apps hosts, the HTTP fallback route) the native
      // anchor is the working path, so leave the default action alone.
      // Deliberately no location.href fallback on this link: it would
      // navigate the widget iframe away from the widget.
      var host = null;
      try { host = window.openai; } catch (_) {}
      if (!host || typeof host.openExternal !== 'function') return;
      if (e && e.preventDefault) e.preventDefault();
      var opened = host.openExternal({ href: yahooLink.href });
      if (opened && typeof opened.catch === 'function') {
        opened.catch(function() { openNewTab(yahooLink.href); });
      }
      if (opened === false) openNewTab(yahooLink.href);
    });
  }

  // Extract payload data from any wrapper format
  function unwrapPayload(obj) {
    if (!obj) return null;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch(e) { return null; }
    }
    if (obj.structuredContent) return unwrapPayload(obj.structuredContent);
    if (obj.toolOutput) return unwrapPayload(obj.toolOutput);
    if (obj.result) return unwrapPayload(obj.result);
    if (obj.output) return unwrapPayload(obj.output);
    if (obj.params && obj.params.structuredContent) return unwrapPayload(obj.params.structuredContent);
    if (obj.content && obj.content[0] && obj.content[0].text) return unwrapPayload(obj.content[0].text);
    return obj;
  }

  // Extract session data from any wrapper format
  function extract(obj) {
    var payload = unwrapPayload(obj);
    if (payload && payload.allLeagues) return payload;
    return null;
  }

  function extractRefreshResult(obj) {
    var payload = unwrapPayload(obj);
    if (payload && typeof payload === 'object' && payload.success !== undefined) return payload;
    return null;
  }

  function tryToolOutput() {
    if (hasRendered) return;
    if (window.openai && window.openai.toolOutput != null) {
      var data = extract(window.openai.toolOutput);
      if (data) render(data);
    }
  }

  async function refreshLeagues(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!window.openai || typeof window.openai.callTool !== 'function') {
      setRefreshStatus('Open Flaim to manage leagues.', 'error');
      openFallbackUrl(LEAGUES_URL);
      return false;
    }
    setRefreshLoading(true);
    setRefreshStatus('Refreshing leagues...', '');
    try {
      var refreshResult = await window.openai.callTool('refresh_leagues', {});
      var refreshPayload = extractRefreshResult(refreshResult);
      if (refreshResult && refreshResult.isError) {
        throw new Error((refreshPayload && (refreshPayload.error_description || refreshPayload.error)) || 'Refresh failed');
      }
      var classification = classifyRefreshResult(refreshPayload);
      if (classification.reloadSession) {
        var sessionResult = await window.openai.callTool('get_user_session', {});
        var data = extract(sessionResult);
        if (!data && window.openai.toolOutput != null) {
          data = extract(window.openai.toolOutput);
        }
        if (!data) {
          throw new Error('Session data unavailable');
        }
        render(data);
      }
      if (classification.showLeaguesLink || classification.kind === 'reconnect' || classification.kind === 'failure' ||
          (classification.kind === 'unchanged' && !classification.reloadSession)) {
        setRefreshStatus(classification.message + ' <a href="' + LEAGUES_URL + '" target="_blank" rel="noopener">Open leagues</a>.', 'error');
      } else {
        var statusKind = classification.kind === 'success' ? 'success' : '';
        setRefreshStatus(classification.message, statusKind);
      }
    } catch (_) {
      setRefreshStatus('Refresh failed. <a href="' + LEAGUES_URL + '" target="_blank" rel="noopener">Open leagues</a>.', 'error');
    } finally {
      setRefreshLoading(false);
    }
    return false;
  }

  // ChatGPT compatibility: listen for openai:set_globals CustomEvent. Theme
  // updates apply after the first render; tool output does not.
  window.addEventListener('openai:set_globals', function(event) {
    var globals = event && event.detail && event.detail.globals;
    applyTheme(globals && globals.theme !== undefined ? globals.theme : readHostTheme());
    if (hasRendered) return;
    if (globals && globals.toolOutput !== undefined) {
      tryToolOutput();
    }
  });

  // ChatGPT compatibility: theme and toolOutput may already be set.
  applyTheme(readHostTheme());
  tryToolOutput();
  document.addEventListener('DOMContentLoaded', tryToolOutput);

  // MCP Apps bridge: receive lifecycle messages and tool-result notifications.
  window.addEventListener('message', function(event) {
    if (!event.data) return;
    if (!isTrustedMessageEvent(event)) return;
    var msg = event.data;

    if (msg.jsonrpc === '2.0' && msg.id === initId) {
      sendInitialized();
      return;
    }

    if (msg.jsonrpc === '2.0' && msg.method === 'ui/resource-teardown') {
      if (msg.id !== undefined && msg.id !== null) {
        postToParent({ jsonrpc: '2.0', id: msg.id, result: {} });
      }
      return;
    }

    if (hasRendered) return;

    if (msg.jsonrpc === '2.0' && msg.method === 'ui/notifications/tool-result') {
      var data = extract(msg.params);
      if (data) render(data);
      return;
    }
    // Direct data
    var data = extract(msg);
    if (data) render(data);
  });
  // Safe in non-MCP hosts: postToParent no-ops when the widget is top-level,
  // and ChatGPT window.openai data paths remain independent of initialization.
  startMcpAppsLifecycle();
})();
</script>
${TABLER_LICENSE_HTML}
</body>
</html>`;
}

/**
 * Body served at the v1 and v2 URIs. Their published widget CSP allows only
 * https://flaim.app as a redirect domain, so this body carries no other
 * external link.
 */
export const LEGACY_USER_SESSION_WIDGET_HTML = buildUserSessionWidgetHtml({ linkYahoo: false });

/**
 * Body served at the v3 URI (the tool descriptor target) and at the
 * version-less HTTP fallback routes. v3's published widget CSP also allows
 * https://sports.yahoo.com, so the Yahoo Fantasy credit is a link here.
 */
export const USER_SESSION_WIDGET_HTML = buildUserSessionWidgetHtml({ linkYahoo: true });
