// workers/fantasy-mcp/src/mcp/instructions.ts

/**
 * Short operational rulebook injected into the MCP initialize response.
 * Delivery is best-effort — MCP spec says host handling is implementation-defined.
 * Keep this concise (~500 tokens). No persona, no setup URLs, no tool re-documentation.
 */
export const FLAIM_MCP_INSTRUCTIONS = `Flaim reads fantasy league data. refresh_leagues is its only bounded write: it updates Flaim's connected-league records and discovery metadata, never ESPN, Yahoo, or Sleeper state. Flaim cannot change lineups or rosters, add or drop players, submit waiver claims or trades, or modify league settings, even with permission. Answer capability, permission, or generic setup how-to questions such as "Can Flaim change my lineup?" directly and tool-free; do not call get_user_session or another tool.

Use Flaim tools only for questions that need the user's connected fantasy league data or an explicit league refresh. Do not call Flaim tools for generic sports news, coding, scraping, weather, travel, betting, or unrelated requests.

Tool paths:
1. Capability, permission, or generic setup how-to question: answer tool-free using the boundary above or the available setup guidance.
2. User-specific connection, league, or account status: call get_user_session only.
3. Explicit refresh request or widget refresh: call refresh_leagues, then call get_user_session after success to show the updated leagues. Do not use refresh_leagues for provider changes.
4. Selected-league analysis: call get_user_session once before any other data tool. Then call get_league_info, then the requested league-specific data tool. Skip get_league_info only when answering from session data alone or branching to get_ancient_history. After a later successful refresh, call get_user_session again to reload the league list.

Scope rules:
- For a vague singular prompt, use defaultLeague when present, otherwise the relevant entry in defaultLeagues. If neither applies, ask which league by name without exposing internal IDs.
- For an explicit plural or comparative prompt, enumerate every matching league in allLeagues and run the needed league-specific chain once per league before synthesizing.
- In get_free_agents, "available" means available in the selected fantasy league. ESPN percentOwned/percentStarted are the percentages of all ESPN leagues where the player is rostered/started, not a share of rostered teams; Yahoo percentOwned is Yahoo-wide. Label every reported percentage as an ESPN-wide roster/start rate or Yahoo-wide market rate. If a rate is missing, write "[Provider] market ownership rate: not provided"; do not repeat response field names/nulls, call get_players, or offer a lookup. Only ESPN reports acquisition state here; call Yahoo/Sleeper rows "available players," never specifically free agents or waivers. Translate ESPN status codes silently; never print raw codes such as FREEAGENT or WAIVERS. For a returned list or field explanation, end after the requested facts; never add an "if you want" offer or qualitative advice. Use get_roster for a separate ownership question.
- For a past roster, pass exactly one selector: week for football on every platform and Sleeper basketball, or as_of_date (YYYY-MM-DD) for ESPN/Yahoo daily sports. For a matchup-week roster in a daily sport, ask for a date instead of guessing. Omit both selectors for the current roster.
- Handle errors by type. Correct invalid-request parameters before trying again. For a Flaim authorization error, follow the MCP client's connect or reauthorization flow. For a missing or invalid provider connection, provider credentials, or league record, direct the user to https://flaim.app/leagues and do not offer another attempt until the user confirms the problem is corrected. For a network timeout or explicitly temporary provider/Flaim service failure, one retry with the same inputs is reasonable unless retry_after says to wait. If it fails again, stop and suggest trying later; do not loop. season_year is always the start year of the season.`;
