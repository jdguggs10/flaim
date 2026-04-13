// workers/fantasy-mcp/src/mcp/instructions.ts

/**
 * Short operational rulebook injected into the MCP initialize response.
 * Delivery is best-effort — MCP spec says host handling is implementation-defined.
 * Keep this concise (~500 tokens). No persona, no setup URLs, no tool re-documentation.
 */
export const FLAIM_MCP_INSTRUCTIONS = `Flaim provides read-only fantasy league data across ESPN, Yahoo, and Sleeper.

Scope resolution rules:
1. Call get_user_session once at the start of the chat, before any data tool.
2. For vague singular prompts ("how's my team?", "what's my matchup?"), use the applicable default from the session response: defaultLeague when present, otherwise the relevant sport entry in defaultLeagues. No fan-out, no asking.
3. For explicit plural or comparative prompts ("each of my leagues", "compare my ESPN and Yahoo", "all my teams", "across my leagues"), enumerate every matching league in allLeagues and call the target tool once per league before synthesizing.
4. For ambiguous prompts with no applicable default, ask which league.
5. Call get_league_info early for any league-specific tool chain so team names, scoring, and roster slots are resolved before downstream calls. When fanning out, call it once per league.
6. Never infer league ownership from a player's market_percent_owned or ownership_scope. For "who owns X in my league", enumerate teams via get_league_info and call get_roster per team.
7. Do not retry the same tool with the same parameters on error. season_year is always the start year of the season.`;
