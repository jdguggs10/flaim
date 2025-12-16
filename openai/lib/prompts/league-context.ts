/**
 * League Context Builder
 *
 * Builds dynamic context about the user's fantasy leagues to send to the LLM.
 * Edit the TEMPLATES below to change the format of context sent to the LLM.
 *
 * Token estimate: ~80-120 tokens depending on number of leagues
 */

import useOnboardingStore from "@/stores/useOnboardingStore";
import type { EspnLeague } from "@/lib/espn-types";

// =============================================================================
// TEMPLATES - Edit these to change the format sent to the LLM
// =============================================================================

/**
 * Template for the active league context.
 * Placeholders: {{leagueName}}, {{leagueId}}, {{sport}}, {{teamName}}, {{teamId}}, {{seasonYear}}
 */
const ACTIVE_LEAGUE_TEMPLATE = `
USER'S ACTIVE LEAGUE:
- League: {{leagueName}}
- League ID: {{leagueId}}
- Sport: {{sport}}
- My Team: {{teamName}} (Team ID: {{teamId}})
- Season: {{seasonYear}}

Use league_id "{{leagueId}}" for tool calls when I ask about "my league" or "my team".
`.trim();

/**
 * Template for listing other available leagues.
 * Placeholder: {{leaguesList}} will be replaced with formatted list
 */
const OTHER_LEAGUES_TEMPLATE = `

OTHER LEAGUES AVAILABLE:
{{leaguesList}}
If I ask about one of these, use the corresponding league_id.
`.trim();

/**
 * Template for each league in the "other leagues" list.
 * Placeholders: {{leagueName}}, {{sport}}, {{leagueId}}
 */
const OTHER_LEAGUE_ITEM_TEMPLATE = `- {{leagueName}} ({{sport}}, ID: {{leagueId}})`;

// =============================================================================
// BUILDER FUNCTION
// =============================================================================

/**
 * Fills template placeholders with actual values
 */
function fillTemplate(template: string, values: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

/**
 * Formats a league for the "other leagues" list
 */
function formatOtherLeague(league: EspnLeague): string {
  return fillTemplate(OTHER_LEAGUE_ITEM_TEMPLATE, {
    leagueName: league.leagueName || `League ${league.leagueId}`,
    sport: league.sport,
    leagueId: league.leagueId,
  });
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
  const { espnLeagues, getActiveLeague } = useOnboardingStore.getState();
  const activeLeague = getActiveLeague();

  // No leagues configured - return empty (no context to inject)
  if (!activeLeague || espnLeagues.length === 0) {
    return "";
  }

  // Build active league context from template
  const activeContext = fillTemplate(ACTIVE_LEAGUE_TEMPLATE, {
    leagueName: activeLeague.leagueName || `League ${activeLeague.leagueId}`,
    leagueId: activeLeague.leagueId,
    sport: activeLeague.sport,
    teamName: activeLeague.teamName || "Not selected",
    teamId: activeLeague.teamId || "N/A",
    seasonYear: String(activeLeague.seasonYear || new Date().getFullYear()),
  });

  // Find other leagues (excluding the active one)
  const otherLeagues = espnLeagues.filter(
    (l) =>
      `${l.leagueId}-${l.sport}` !==
      `${activeLeague.leagueId}-${activeLeague.sport}`
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
