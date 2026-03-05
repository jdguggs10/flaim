// workers/fantasy-mcp/src/widgets/user-session-widget.ts

/**
 * Self-contained HTML widget for the get_user_session tool.
 * Renders the user's fantasy leagues inline in ChatGPT via the Apps SDK widget protocol.
 *
 * Design constraints:
 * - No external scripts, fonts, or stylesheets (CSP-safe for iframe)
 * - 353px wide (ChatGPT text response template)
 * - System fonts only
 * - Aligns with flaim.app branding
 *
 * Data access:
 * - Primary: window.openai.toolOutput (synchronous, available on load)
 * - Fallback: postMessage from parent (use event.source === window.parent, NOT origin allowlist)
 */
export const USER_SESSION_WIDGET_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=353" />
<title>Flaim – Your Leagues</title>
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
  .hero-icon { font-size: 22px; }
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
</style>
</head>
<body>
<div class="widget">
  <div class="header">
    <span class="hero-icon">\u{1F525}\u26BE</span>
    <span class="app-name">Flaim</span>
  </div>
  <div id="content">
    <div class="loading">Loading&hellip;</div>
  </div>
</div>
<script>
(function() {
  var VALID_PLATFORMS = { espn: true, yahoo: true, sleeper: true };
  var SPORT_ICONS = {
    football: '\\u{1F3C8}',
    baseball: '\\u26BE',
    basketball: '\\u{1F3C0}',
    hockey: '\\u{1F3D2}'
  };
  // Order sports: baseball first, then football, basketball, hockey, then anything else
  var SPORT_ORDER = { baseball: 0, football: 1, basketball: 2, hockey: 3 };

  function render(data) {
    var container = document.getElementById('content');
    if (!data || !data.allLeagues || data.allLeagues.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        'No leagues found.<br>' +
        '<a href="https://flaim.app/leagues" target="_blank" rel="noopener">Connect a league</a>' +
        '</div>';
      return;
    }

    var leagues = data.allLeagues;

    // Build set of default league keys (per-sport defaults from defaultLeagues map)
    var defaultKeys = {};
    if (data.defaultLeagues) {
      Object.keys(data.defaultLeagues).forEach(function(sport) {
        var dl = data.defaultLeagues[sport];
        if (dl) {
          defaultKeys[dl.platform + ':' + dl.leagueId + ':' + dl.seasonYear] = true;
        }
      });
    }
    // Also include the primary default
    if (data.defaultLeague) {
      defaultKeys[data.defaultLeague.platform + ':' + data.defaultLeague.leagueId + ':' + data.defaultLeague.seasonYear] = true;
    }

    // Determine which sports have a default (for the DEFAULT pill on the sport header)
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

    // Sort sports by preferred order
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
      html += '<span class="sport-label">' + (SPORT_ICONS[sport] || '') + ' ' + esc(sport) + '</span>';
      if (isDefaultSport) {
        html += '<span class="default-pill">DEFAULT</span>';
      }
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
        if (league.seasonYear) detail.push(league.seasonYear);
        html += '<div class="league-detail">' + esc(detail.join(' \\u00B7 ')) + '</div>';
        html += '</div></div>';
      });
      html += '</div>';
    });

    container.innerHTML = html;
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  var rendered = false;

  function tryReadToolOutput() {
    if (rendered) return;
    if (window.openai && window.openai.toolOutput) {
      try {
        var output = typeof window.openai.toolOutput === 'string'
          ? JSON.parse(window.openai.toolOutput)
          : window.openai.toolOutput;
        render(output);
        rendered = true;
      } catch (e) {
        // ignore parse errors
      }
    }
  }

  // Try reading immediately
  tryReadToolOutput();

  // Retry on DOMContentLoaded and after short delays (SDK may inject after initial parse)
  document.addEventListener('DOMContentLoaded', tryReadToolOutput);
  setTimeout(tryReadToolOutput, 100);
  setTimeout(tryReadToolOutput, 500);

  // Fallback: listen for postMessage from parent
  window.addEventListener('message', function(event) {
    if (rendered) return;
    if (event.source !== window.parent) return;
    var data = null;
    if (event.data && event.data.method === 'ui/notifications/tool-result') {
      data = (event.data.params || {}).structuredContent || null;
    } else if (event.data && event.data.structuredContent) {
      data = event.data.structuredContent;
    } else if (event.data && event.data.allLeagues) {
      data = event.data;
    }
    if (data) {
      render(data);
      rendered = true;
    }
  });
})();
</script>
</body>
</html>`;
