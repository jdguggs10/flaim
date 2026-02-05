/**
 * League Context Builder
 *
 * Builds dynamic context about the user's fantasy leagues to send to the LLM.
 * Edit the TEMPLATES below to change the format of context sent to the LLM.
 *
 * Token estimate: ~80-120 tokens depending on number of leagues
 */

import useLeaguesStore, { makeLeagueKey, type ChatLeague } from "@/stores/chat/useLeaguesStore";

// =============================================================================
// TEMPLATES - Edit these to change the format sent to the LLM
// =============================================================================

/**
 * Template for the active league context.
 * Placeholders: {{leagueName}}, {{leagueId}}, {{sport}}, {{teamName}}, {{teamId}}, {{seasonYear}}
 */
const ACTIVE_LEAGUE_TEMPLATE = `
USER'S ACTIVE LEAGUE:
- Platform: {{platform}}
- League: {{leagueName}}
- League ID: {{leagueId}}
- Sport: {{sport}}
- My Team: {{teamName}} (Team ID: {{teamId}})
- Season: {{seasonYear}}

Use platform "{{platform}}", league_id "{{leagueId}}", and sport "{{sport}}" for tool calls when I ask about "my league" or "my team".
`.trim();

/**
 * Template for listing other available leagues.
 * Placeholder: {{leaguesList}} will be replaced with formatted list
 */
const OTHER_LEAGUES_TEMPLATE = `

OTHER LEAGUES (current seasons):
{{leaguesList}}
If I ask about one of these, use the corresponding league_id.
For historical leagues/seasons (2+ years old), use get_ancient_history.
`.trim();

/**
 * Template for each league in the "other leagues" list.
 * Placeholders: {{leagueName}}, {{sport}}, {{leagueId}}, {{seasonYear}}, {{platform}}
 */
const OTHER_LEAGUE_ITEM_TEMPLATE = `- {{leagueName}} ({{platform}} {{sport}}, ID: {{leagueId}}, {{seasonYear}})`;

// =============================================================================
// BUILDER FUNCTION
// =============================================================================

/**
 * Fills template placeholders with actual values (single-pass)
 */
function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([^{}]+)\}\}/g, (_, key) => values[key] ?? "");
}

/**
 * Formats a league for the "other leagues" list
 */
function formatOtherLeague(league: ChatLeague): string {
  return fillTemplate(OTHER_LEAGUE_ITEM_TEMPLATE, {
    leagueName: league.leagueName || `League ${league.leagueId}`,
    platform: league.platform,
    sport: league.sport,
    leagueId: league.leagueId,
    seasonYear: String(league.seasonYear || ""),
  });
}

/**
 * Returns true if a league is from a recent season (current or previous year).
 * Leagues 2+ years old are considered "ancient" and excluded from prompt context.
 */
function isRecentLeague(league: ChatLeague): boolean {
  if (!league.seasonYear) return true; // include if unknown
  const currentYear = new Date().getFullYear();
  return league.seasonYear >= currentYear - 1;
}

/**
 * Builds the dynamic league context string to inject into the LLM conversation.
 *
 * Returns an empty string if no leagues are configured, which signals
 * to the caller not to inject any league context.
 *
 * @returns Formatted league context string or empty string
 */
export function buildLeagueContext(): string {
  const { leagues, getActiveLeague } = useLeaguesStore.getState();
  const activeLeague = getActiveLeague();

  // No active league - return empty (no context to inject)
  if (!activeLeague) {
    return "";
  }

  // The stored seasonYear is canonical (auth-worker normalizes at discovery).
  const seasonYear = activeLeague.seasonYear || new Date().getFullYear();

  // Build active league context from template
  const activeContext = fillTemplate(ACTIVE_LEAGUE_TEMPLATE, {
    platform: activeLeague.platform,
    leagueName: activeLeague.leagueName || `League ${activeLeague.leagueId}`,
    leagueId: activeLeague.leagueId,
    sport: activeLeague.sport,
    teamName: activeLeague.teamName || "Not selected",
    teamId: activeLeague.teamId || "N/A",
    seasonYear: String(seasonYear),
  });

  // Find other leagues (excluding the active one, filtering to recent seasons only)
  const otherLeagues = leagues.filter(
    (league) => makeLeagueKey(league) !== makeLeagueKey(activeLeague) && isRecentLeague(league)
  );

  // If user only has one league, just return active context
  if (otherLeagues.length === 0) {
    return activeContext;
  }

  // Build other leagues list
  const leaguesList = otherLeagues.map(formatOtherLeague).join("\n");

  const otherContext = fillTemplate(OTHER_LEAGUES_TEMPLATE, {
    leaguesList,
  });

  return `${activeContext}\n${otherContext}`;
}
