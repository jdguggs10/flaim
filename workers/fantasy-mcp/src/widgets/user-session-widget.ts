// workers/fantasy-mcp/src/widgets/user-session-widget.ts

/**
 * Self-contained HTML widget for the get_user_session tool.
 * Renders the user's fantasy leagues inline in ChatGPT via the Apps SDK widget protocol.
 *
 * Design constraints:
 * - No external scripts, fonts, images, or stylesheets (CSP-safe for iframe sandbox)
 * - 353px wide (ChatGPT text response template)
 * - System fonts only
 * - Aligns with flaim.app branding
 *
 * Data access — tries every known method:
 * 1. window.openai.toolOutput (Apps SDK synchronous)
 * 2. postMessage from parent in any known envelope format
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
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #0b1222;
    background: #fff;
    width: 353px;
    overflow-x: hidden;
  }
  .widget { padding: 16px; }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid #e4e7ec;
  }
  .app-name {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #0b1222;
  }
  .sport-group { margin-bottom: 12px; }
  .sport-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    padding-left: 2px;
  }
  .sport-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b7280;
  }
  .default-pill {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 4px;
    background: #fbbf24;
    color: #78350f;
  }
  .league-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: #f8f9fb;
    margin-bottom: 4px;
    border-right: 3px solid transparent;
  }
  .league-row.is-default {
    border-right-color: #fbbf24;
  }
  .platform-badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 0;
    border-radius: 4px;
    color: #fff;
    flex-shrink: 0;
    width: 56px;
    text-align: center;
  }
  .platform-espn { background: #c4122e; }
  .platform-yahoo { background: #7b1fa2; }
  .platform-sleeper { background: #1b9e5a; }
  .league-info { flex: 1; min-width: 0; }
  .league-name {
    font-size: 13px;
    font-weight: 600;
    color: #0b1222;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .league-detail {
    font-size: 11px;
    color: #6b7280;
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
  .debug {
    font-size: 10px;
    color: #ccc;
    text-align: center;
    padding-top: 4px;
    word-break: break-all;
  }
</style>
</head>
<body>
<div class="widget">
  <div class="header">
    <span class="app-name">Flaim</span>
  </div>
  <div id="content">
    <div class="loading">Loading&hellip;</div>
  </div>
  <div id="debug"></div>
</div>
<script>
(function() {
  var VALID_PLATFORMS = { espn: true, yahoo: true, sleeper: true };
  var SPORT_ORDER = { baseball: 0, football: 1, basketball: 2, hockey: 3 };
  var rendered = false;
  var dbg = document.getElementById('debug');

  function log(msg) {
    if (dbg) dbg.textContent = msg;
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
    if (data.defaultLeague) {
      defaultKeys[data.defaultLeague.platform + ':' + data.defaultLeague.leagueId + ':' + data.defaultLeague.seasonYear] = true;
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
      var oa = SPORT_ORDER[a] !== undefined ? SPORT_ORDER[a] : 99;
      var ob = SPORT_ORDER[b] !== undefined ? SPORT_ORDER[b] : 99;
      return oa - ob;
    });

    var html = '';
    order.forEach(function(sport) {
      var isDefaultSport = sport === defaultSport;
      html += '<div class="sport-group">';
      html += '<div class="sport-header">';
      html += '<span class="sport-label">' + esc(sport) + '</span>';
      if (isDefaultSport) html += '<span class="default-pill">DEFAULT</span>';
      html += '</div>';
      groups[sport].forEach(function(league) {
        var key = league.platform + ':' + league.leagueId + ':' + league.seasonYear;
        var isDefault = !!defaultKeys[key];
        var platform = VALID_PLATFORMS[league.platform] ? league.platform : 'espn';
        html += '<div class="league-row' + (isDefault ? ' is-default' : '') + '">';
        html += '<span class="platform-badge platform-' + platform + '">' + esc(league.platform || '') + '</span>';
        html += '<div class="league-info">';
        html += '<div class="league-name">' + esc(league.leagueName || league.leagueId || '') + '</div>';
        var detail = [];
        if (league.teamName) detail.push(league.teamName);
        if (league.seasonYear) detail.push(String(league.seasonYear));
        html += '<div class="league-detail">' + esc(detail.join(' · ')) + '</div>';
        html += '</div></div>';
      });
      html += '</div>';
    });

    container.innerHTML = html;
    rendered = true;
    log('');
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // Extract session data from any wrapper format
  function extract(obj) {
    if (!obj) return null;
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch(e) { return null; }
    }
    // Direct data (has allLeagues)
    if (obj.allLeagues) return obj;
    // Nested in structuredContent
    if (obj.structuredContent) return extract(obj.structuredContent);
    // Nested in params.structuredContent
    if (obj.params && obj.params.structuredContent) return extract(obj.params.structuredContent);
    // Nested in content[0].text
    if (obj.content && obj.content[0] && obj.content[0].text) return extract(obj.content[0].text);
    return null;
  }

  function tryToolOutput() {
    if (rendered) return;
    try {
      if (window.openai && window.openai.toolOutput) {
        var data = extract(window.openai.toolOutput);
        if (data) { render(data); return; }
        log('toolOutput found but no allLeagues');
      }
    } catch(e) {
      log('toolOutput error: ' + e.message);
    }
  }

  // Try immediately, on DOMContentLoaded, and with delays
  tryToolOutput();
  document.addEventListener('DOMContentLoaded', tryToolOutput);
  setTimeout(tryToolOutput, 50);
  setTimeout(tryToolOutput, 200);
  setTimeout(tryToolOutput, 1000);
  setTimeout(function() {
    if (!rendered) log('no data received');
  }, 3000);

  // Listen for ANY postMessage and try to extract data
  window.addEventListener('message', function(event) {
    if (rendered) return;
    var data = extract(event.data);
    if (data) {
      render(data);
    }
  });
})();
</script>
</body>
</html>`;
