// workers/fantasy-mcp/src/widgets/user-session-widget.ts

/**
 * Self-contained HTML widget for the get_user_session tool.
 * Renders the user's fantasy leagues inline in ChatGPT via the Apps SDK widget protocol.
 *
 * Design constraints:
 * - No external scripts, fonts, or stylesheets (CSP-safe for iframe)
 * - 353px wide (ChatGPT text response template)
 * - System fonts only
 * - Light background to match ChatGPT container
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
    color: #1a1a1a;
    background: #fff;
    width: 353px;
    overflow-x: hidden;
  }
  .widget { padding: 16px; }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  .wordmark {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #1a1a1a;
  }
  .wordmark .ai { color: #61f2b0; }
  .sport-group { margin-bottom: 12px; }
  .sport-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
    margin-bottom: 6px;
  }
  .league-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-radius: 8px;
    background: #f9f9f9;
    margin-bottom: 4px;
  }
  .league-row.is-default {
    border-left: 3px solid #61f2b0;
    padding-left: 5px;
  }
  .sport-icon { font-size: 16px; flex-shrink: 0; width: 20px; text-align: center; }
  .platform-badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 4px;
    color: #fff;
    flex-shrink: 0;
  }
  .platform-espn { background: #c4122e; }
  .platform-yahoo { background: #7b1fa2; }
  .platform-sleeper { background: #1b9e5a; }
  .league-info { flex: 1; min-width: 0; }
  .league-name {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .league-detail {
    font-size: 11px;
    color: #666;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty-state {
    text-align: center;
    padding: 24px 16px;
    color: #666;
  }
  .empty-state a {
    color: #1a1a1a;
    font-weight: 600;
    text-decoration: underline;
  }
</style>
</head>
<body>
<div class="widget">
  <div class="header">
    <span class="wordmark">fl<span class="ai">ai</span>m</span>
  </div>
  <div id="content">
    <div class="empty-state">Loading&hellip;</div>
  </div>
</div>
<script>
(function() {
  var SPORT_ICONS = {
    football: '\\u{1F3C8}',
    baseball: '\\u26BE',
    basketball: '\\u{1F3C0}',
    hockey: '\\u{1F3D2}'
  };

  function render(data) {
    var container = document.getElementById('content');
    if (!data || !data.allLeagues || data.allLeagues.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        'No leagues configured.<br>' +
        '<a href="https://flaim.app/settings" target="_blank" rel="noopener">Add leagues in Settings</a>' +
        '</div>';
      return;
    }

    var defaultKey = data.defaultLeague
      ? data.defaultLeague.platform + ':' + data.defaultLeague.leagueId + ':' + data.defaultLeague.seasonYear
      : null;

    // Group by sport
    var groups = {};
    var order = [];
    data.allLeagues.forEach(function(league) {
      var sport = (league.sport || 'other').toLowerCase();
      if (!groups[sport]) {
        groups[sport] = [];
        order.push(sport);
      }
      groups[sport].push(league);
    });

    var html = '';
    order.forEach(function(sport) {
      html += '<div class="sport-group">';
      html += '<div class="sport-label">' + (SPORT_ICONS[sport] || '') + ' ' + sport + '</div>';
      groups[sport].forEach(function(league) {
        var key = league.platform + ':' + league.leagueId + ':' + league.seasonYear;
        var isDefault = key === defaultKey;
        var platformClass = 'platform-' + (league.platform || 'espn');
        html += '<div class="league-row' + (isDefault ? ' is-default' : '') + '">';
        html += '<span class="platform-badge ' + platformClass + '">' + esc(league.platform || '') + '</span>';
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

  window.addEventListener('message', function(event) {
    if (event.data && event.data.method === 'ui/notifications/tool-result') {
      var params = event.data.params || {};
      var data = params.structuredContent || null;
      if (data) render(data);
    }
  });
})();
</script>
</body>
</html>`;
