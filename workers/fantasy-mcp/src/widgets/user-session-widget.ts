// workers/fantasy-mcp/src/widgets/user-session-widget.ts

/**
 * Self-contained HTML widget for the get_user_session tool.
 * Renders the user's fantasy leagues inline through the MCP Apps bridge, with
 * ChatGPT window.openai compatibility as a fallback.
 *
 * Design constraints:
 * - No external scripts, fonts, images, or stylesheets (CSP-safe for iframe sandbox)
 * - 353px wide (ChatGPT text response template)
 * - System fonts only
 * - Aligns with flaim.app branding
 *
 * Data access - in order of priority:
 * 1. MCP Apps postMessage JSON-RPC ui/notifications/tool-result
 * 2. openai:set_globals CustomEvent -> window.openai.toolOutput
 * 3. window.openai.toolOutput on immediate/DOMContentLoaded (may already be set)
 *
 * References:
 * - https://developers.openai.com/apps-sdk/build/chatgpt-ui/
 * - https://developers.openai.com/apps-sdk/build/mcp-server/
 */
export const USER_SESSION_WIDGET_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=353" />
<title>Flaim</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Geist", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #0d0d0d;
    background: #fff;
    width: 353px;
    overflow-x: hidden;
    padding: 0;
  }
  .widget {
    position: relative;
    background: #fff;
    border-radius: 24px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
    border: 0.5px solid rgba(13, 13, 13, 0.15);
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 12px;
    border-bottom: 1px solid rgba(13, 13, 13, 0.05);
  }
  .app-name {
    font-size: 17px;
    line-height: 24px;
    font-weight: 500;
    letter-spacing: -0.4px;
    color: #0d0d0d;
  }
  .edit-link {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    color: #0d0d0d;
  }
  .edit-link svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }
  .sport-group {}
  .sport-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px 8px;
  }
  .sport-label {
    font-size: 14px;
    line-height: 20px;
    font-weight: 500;
    letter-spacing: -0.18px;
    color: #5d5d5d;
  }
  .default-label {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #fff;
    background: #fbbf24;
    border: 0;
    border-radius: 999px;
    padding: 2px 8px;
    line-height: 1.3;
  }
  .league-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(13, 13, 13, 0.05);
  }
  .league-row.is-last {
    border-bottom: 0;
  }
  .league-row.is-default::after {
    content: "";
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: #fbbf24;
    border-radius: 2px 0 0 2px;
  }
  .platform-badge {
    font-size: 10px;
    font-weight: 500;
    line-height: 14px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 4px 0;
    border-radius: 999px;
    color: #fff;
    flex-shrink: 0;
    width: 64px;
    text-align: center;
  }
  .platform-espn { background: #c4122e; }
  .platform-yahoo { background: #7b1fa2; }
  .platform-sleeper { background: #137a45; }
  .league-info { flex: 1; min-width: 0; }
  .league-name {
    font-size: 15px;
    line-height: 20px;
    font-weight: 400;
    letter-spacing: -0.3px;
    color: #0d0d0d;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .league-detail {
    margin-top: 2px;
    font-size: 13px;
    line-height: 18px;
    font-weight: 400;
    letter-spacing: -0.2px;
    color: #5d5d5d;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty-state {
    text-align: center;
    padding: 24px 16px;
    color: #6b7280;
    font-size: 13px;
  }
  .empty-state a {
    color: #0b1222;
    font-weight: 600;
    text-decoration: underline;
  }
  .loading {
    text-align: center;
    padding: 24px 16px;
    color: #9ca3af;
    font-size: 13px;
  }
</style>
</head>
<body>
<div class="widget">
  <div class="header">
    <span class="app-name">Your Leagues</span>
    <a href="https://flaim.app/leagues" target="_blank" rel="noopener" class="edit-link" aria-label="Edit leagues" id="edit-link">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15.6729 2.32843C15.235 1.89052 14.525 1.89052 14.0871 2.32843L8.14992 8.26562C7.69093 8.72461 7.39319 9.32009 7.30139 9.96267L7.17851 10.8228L8.03865 10.6999C8.68123 10.6081 9.27671 10.3104 9.7357 9.8514L15.6729 3.91421C16.1108 3.47631 16.1108 2.76633 15.6729 2.32843ZM12.6729 0.914213C13.8918 -0.304738 15.8682 -0.304738 17.0871 0.914213C18.3061 2.13316 18.3061 4.10948 17.0871 5.32843L11.1499 11.2656C10.3849 12.0306 9.39247 12.5268 8.32149 12.6798L6.14142 12.9913C5.82983 13.0358 5.51546 12.931 5.29289 12.7084C5.07033 12.4859 4.96554 12.1715 5.01005 11.8599L5.32149 9.67983C5.47449 8.60885 5.97072 7.61639 6.7357 6.8514L12.6729 0.914213ZM8 1.00063C8.00043 1.55291 7.55306 2.00098 7.00078 2.00141C6.00227 2.00219 5.29769 2.00962 4.74651 2.06198C4.20685 2.11326 3.88488 2.20251 3.63803 2.32829C3.07354 2.61591 2.6146 3.07485 2.32698 3.63934C2.19279 3.90269 2.10062 4.25038 2.05118 4.85555C2.00078 5.47239 2 6.2647 2 7.40131V10.6013C2 11.7379 2.00078 12.5302 2.05118 13.1471C2.10062 13.7522 2.19279 14.0999 2.32698 14.3633C2.6146 14.9278 3.07354 15.3867 3.63803 15.6743C3.90138 15.8085 4.24907 15.9007 4.85424 15.9501C5.47108 16.0005 6.26339 16.0013 7.4 16.0013H10.6C11.7366 16.0013 12.5289 16.0005 13.1458 15.9501C13.7509 15.9007 14.0986 15.8085 14.362 15.6743C14.9265 15.3867 15.3854 14.9278 15.673 14.3633C15.7988 14.1164 15.8881 13.7945 15.9393 13.2548C15.9917 12.7036 15.9991 11.999 15.9999 11.0005C16.0003 10.4482 16.4484 10.0009 17.0007 10.0013C17.553 10.0017 18.0003 10.4498 17.9999 11.0021C17.9991 11.9803 17.9932 12.7821 17.9304 13.444C17.8664 14.1173 17.7385 14.715 17.455 15.2713C16.9757 16.2121 16.2108 16.977 15.27 17.4563C14.6777 17.7581 14.0375 17.8839 13.3086 17.9435C12.6008 18.0013 11.7266 18.0013 10.6428 18.0013H7.35717C6.27339 18.0013 5.39925 18.0013 4.69138 17.9435C3.96253 17.8839 3.32234 17.7581 2.73005 17.4563C1.78924 16.977 1.02433 16.2121 0.544968 15.2713C0.24318 14.679 0.117368 14.0388 0.0578183 13.3099C-1.77398e-05 12.6021 -9.75112e-06 11.7279 2.62458e-07 10.6441V7.3585C-9.75112e-06 6.27471 -1.77398e-05 5.40056 0.0578183 4.69268C0.117368 3.96383 0.24318 3.32365 0.544968 2.73135C1.02433 1.79054 1.78924 1.02564 2.73005 0.546275C3.28633 0.262836 3.88399 0.134924 4.55735 0.0709492C5.21919 0.00806886 6.02103 0.00217121 6.99922 0.00140845C7.55151 0.00097781 7.99957 0.448344 8 1.00063Z"></path>
      </svg>
    </a>
  </div>
  <div id="content">
    <div class="loading">Loading&hellip;</div>
  </div>
</div>
<script>
(function() {
  var VALID_PLATFORMS = { espn: true, yahoo: true, sleeper: true };
  var SPORT_ORDER = { baseball: 0, football: 1, basketball: 2, hockey: 3 };
  var SPORT_EMOJI = { baseball: '⚾', football: '🏈', basketball: '🏀', hockey: '🏒' };
  var LEAGUES_URL = 'https://flaim.app/leagues';
  var initId = 'flaim-init-' + Math.random().toString(36).slice(2);
  var initializedSent = false;
  var rendered = false;

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
    if (event.source && window.parent && event.source !== window.parent) return false;
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
    postToParent({
      jsonrpc: '2.0',
      method: 'ui/notifications/size-changed',
      params: {
        // Matches the ChatGPT text-response widget width declared above.
        width: document.documentElement.scrollWidth || 353,
        height: document.documentElement.scrollHeight || document.body.scrollHeight || 0,
      },
    });
  }

  function openLegacyLeagues() {
    try {
      if (window.openai && typeof window.openai.openUrl === 'function') {
        window.openai.openUrl(LEAGUES_URL);
        return false;
      }
    } catch (_) {}
    try {
      window.open(LEAGUES_URL, '_blank', 'noopener,noreferrer');
      return false;
    } catch (_) {}
    try {
      window.location.href = LEAGUES_URL;
    } catch (_) {}
    return false;
  }

  function openLeagues(e) {
    if (e && e.preventDefault) e.preventDefault();
    try {
      if (window.openai && typeof window.openai.openExternal === 'function') {
        var result = window.openai.openExternal({ href: LEAGUES_URL });
        if (result && typeof result.catch === 'function') {
          // A resolved promise only tells us the host accepted the request;
          // rejection is the only observable signal where fallback is useful.
          result.catch(function() { openLegacyLeagues(); });
        }
        return false;
      }
    } catch (_) {}
    return openLegacyLeagues();
  }

  function render(data) {
    if (rendered) return;
    var container = document.getElementById('content');
    if (!data || !data.allLeagues || data.allLeagues.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        'No leagues found.<br>' +
        '<a href="https://flaim.app/leagues" target="_blank" rel="noopener">Connect a league</a>' +
        '</div>';
      rendered = true;
      sendSizeChanged();
      return;
    }

    var leagues = data.allLeagues;

    var defaultKeys = {};
    if (data.defaultLeagues) {
      Object.keys(data.defaultLeagues).forEach(function(sport) {
        var dl = data.defaultLeagues[sport];
        if (dl) defaultKeys[dl.platform + ':' + dl.leagueId + ':' + dl.seasonYear] = true;
      });
    }

    var defaultSport = data.defaultSport || null;

    var groups = {};
    var order = [];
    leagues.forEach(function(league) {
      var sport = (league.sport || 'other').toLowerCase();
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
      var oa = SPORT_ORDER[a] !== undefined ? SPORT_ORDER[a] : 99;
      var ob = SPORT_ORDER[b] !== undefined ? SPORT_ORDER[b] : 99;
      return oa - ob;
    });

    var html = '';
    order.forEach(function(sport) {
      var isDefaultSport = sport === defaultSport;
      html += '<div class="sport-group">';
      html += '<div class="sport-header">';
      html += '<span class="sport-label">' + esc(formatSportLabel(sport)) + '</span>';
      if (isDefaultSport) html += '<span class="default-label">DEFAULTS</span>';
      html += '</div>';
      groups[sport].forEach(function(league) {
        var key = league.platform + ':' + league.leagueId + ':' + league.seasonYear;
        var isDefault = !!defaultKeys[key];
        var platform = VALID_PLATFORMS[league.platform] ? league.platform : 'espn';
        var isLast = false;
        if (sport === order[order.length - 1]) {
          var group = groups[sport];
          isLast = league === group[group.length - 1];
        }
        html += '<div class="league-row' + (isDefault ? ' is-default' : '') + (isLast ? ' is-last' : '') + '">';
        html += '<span class="platform-badge platform-' + platform + '">' + esc(league.platform || '') + '</span>';
        html += '<div class="league-info">';
        html += '<div class="league-name">' + esc(league.leagueName || league.leagueId || '') + '</div>';
        var detail = [];
        if (league.teamName) detail.push(league.teamName);
        if (league.seasonYear) detail.push(String(league.seasonYear));
        html += '<div class="league-detail">' + esc(detail.join(' \\u00B7 ')) + '</div>';
        html += '</div></div>';
      });
      html += '</div>';
    });

    container.innerHTML = html;
    rendered = true;
    sendSizeChanged();
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function formatSportLabel(sport) {
    var label = String(sport || 'Other');
    var title = label.charAt(0).toUpperCase() + label.slice(1);
    var emoji = SPORT_EMOJI[label];
    return emoji ? (emoji + ' ' + title) : title;
  }

  var editLink = document.getElementById('edit-link');
  if (editLink) editLink.addEventListener('click', openLeagues);

  // Extract session data from any wrapper format
  function extract(obj) {
    if (!obj) return null;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch(e) { return null; }
    }
    if (obj.allLeagues) return obj;
    if (obj.structuredContent) return extract(obj.structuredContent);
    if (obj.params && obj.params.structuredContent) return extract(obj.params.structuredContent);
    if (obj.content && obj.content[0] && obj.content[0].text) return extract(obj.content[0].text);
    return null;
  }

  function tryToolOutput() {
    if (rendered) return;
    if (window.openai && window.openai.toolOutput != null) {
      var data = extract(window.openai.toolOutput);
      if (data) render(data);
    }
  }

  // ChatGPT compatibility: listen for openai:set_globals CustomEvent.
  window.addEventListener('openai:set_globals', function(event) {
    if (rendered) return;
    var globals = event.detail && event.detail.globals;
    if (globals && globals.toolOutput !== undefined) {
      tryToolOutput();
    }
  });

  // ChatGPT compatibility: toolOutput may already be set.
  tryToolOutput();
  document.addEventListener('DOMContentLoaded', tryToolOutput);

  // MCP Apps bridge: receive lifecycle messages and tool-result notifications.
  window.addEventListener('message', function(event) {
    if (!event.data) return;
    if (!isTrustedMessageEvent(event)) return;
    var msg = event.data;

    if (msg.jsonrpc === '2.0' && msg.id === initId) {
      if (Object.prototype.hasOwnProperty.call(msg, 'result')) {
        sendInitialized();
      }
      return;
    }

    if (msg.jsonrpc === '2.0' && msg.method === 'ui/resource-teardown') {
      if (msg.id !== undefined && msg.id !== null) {
        postToParent({ jsonrpc: '2.0', id: msg.id, result: {} });
      }
      return;
    }

    if (rendered) return;

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
</body>
</html>`;
