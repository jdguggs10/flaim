/**
 * Homepage public-demo preset list and Supabase cache version tags.
 * LLM system prompts, execution hints, and per-preset generation prompts live only
 * in the `flaim-demo` runner — not here.
 */

export const PUBLIC_CHAT_ALLOWED_TOOLS = [
  "get_user_session",
  "get_ancient_history",
  "get_league_info",
  "get_standings",
  "get_matchups",
  "get_roster",
  "get_free_agents",
  "get_players",
  "get_transactions",
] as const;

export type PublicChatAllowedTool = (typeof PUBLIC_CHAT_ALLOWED_TOOLS)[number];
export type PublicChatPresetRail = "top" | "bottom";
export type PublicChatDemoSport = "football" | "baseball";

/** Metadata for cached demo answers: labels, tool chips, and ticker layout only. */
export interface PublicChatPreset {
  id: string;
  title: string;
  userMessage: string;
  homepageLabel?: string;
  allowedTools: readonly PublicChatAllowedTool[];
  rail?: PublicChatPresetRail;
}

export const PUBLIC_DEMO_PROMPT_VERSION = "v4";
export const PUBLIC_DEMO_CONTEXT_VERSION = "v2";

export const PUBLIC_CHAT_SIMPLE_PRESETS: readonly PublicChatPreset[] = [
  {
    id: "hot-hands",
    title: "Who are this team's best players?",
    userMessage: "Who are this team's best players?",
    allowedTools: ["get_roster"] as const,
    rail: "top",
  },
  {
    id: "league-format",
    title: "Tell me this league's settings.",
    userMessage: "Tell me this league's settings.",
    allowedTools: ["get_league_info"] as const,
    rail: "top",
  },
  {
    id: "quick-start",
    title: "Is this team off to a good start?",
    userMessage: "Is this team off to a good start?",
    allowedTools: ["get_standings"] as const,
    rail: "top",
  },
  {
    id: "this-matchup",
    title: "Is this team winning its matchup this week?",
    userMessage: "Is this team winning its matchup this week?",
    allowedTools: ["get_matchups"] as const,
    rail: "top",
  },
  {
    id: "my-moves",
    title: "Show me this team's recent moves.",
    userMessage: "Show me this team's recent moves.",
    allowedTools: ["get_transactions"] as const,
    rail: "top",
  },
  {
    id: "win-history",
    title: "Has this team ever won this thing?",
    userMessage: "Has this team ever won this thing?",
    allowedTools: ["get_ancient_history", "get_standings"] as const,
    rail: "top",
  },
  {
    id: "start-sit",
    title: "Help with a start/sit decision.",
    userMessage: "Help with a start/sit decision.",
    allowedTools: ["get_roster"] as const,
    rail: "top",
  },
  {
    id: "trade-grades",
    title: "How did the last trade grade out?",
    userMessage: "How did the last trade grade out?",
    allowedTools: ["get_transactions"] as const,
    rail: "top",
  },
] as const;

export const PUBLIC_CHAT_DEEP_PRESETS: readonly PublicChatPreset[] = [
  {
    id: "wire-watch",
    rail: "bottom",
    title: "Give me the best wire add right now.",
    userMessage: "Give me the best wire add right now.",
    allowedTools: ["get_roster", "get_free_agents", "get_players"] as const,
  },
  {
    id: "league-moves",
    rail: "bottom",
    title: "What happened in this league last night?",
    userMessage: "What happened in this league last night?",
    allowedTools: ["get_transactions", "get_players"] as const,
  },
  {
    id: "league-leader",
    rail: "bottom",
    title: "Who is winning this league and why?",
    userMessage: "Who is winning this league and why?",
    allowedTools: ["get_standings", "get_roster", "get_matchups"] as const,
  },
  {
    id: "drop-target",
    rail: "bottom",
    title: "What player should this team give up on?",
    userMessage: "What player should this team give up on?",
    allowedTools: ["get_roster", "get_players"] as const,
  },
  {
    id: "roster-hole",
    rail: "bottom",
    title: "What's this team's biggest roster weakness?",
    userMessage: "What's this team's biggest roster weakness?",
    allowedTools: ["get_roster"] as const,
  },
  {
    id: "sell-high",
    rail: "bottom",
    title: "Who should this team sell high?",
    userMessage: "Who should this team sell high?",
    allowedTools: ["get_roster", "get_players"] as const,
  },
  {
    id: "best-team",
    rail: "bottom",
    title: "Is this the best team in the league?",
    userMessage: "Is this the best team in the league?",
    allowedTools: ["get_standings", "get_roster"] as const,
  },
  {
    id: "last-season",
    rail: "bottom",
    title: "How did this team do last season?",
    userMessage: "How did this team do last season?",
    allowedTools: ["get_ancient_history", "get_standings"] as const,
  },
] as const;

export const PUBLIC_CHAT_PRESETS: readonly PublicChatPreset[] = [
  ...PUBLIC_CHAT_SIMPLE_PRESETS,
  ...PUBLIC_CHAT_DEEP_PRESETS,
];

export type PublicChatPresetId = PublicChatPreset["id"];

export function getPublicChatPreset(
  presetId: string,
): PublicChatPreset | undefined {
  return PUBLIC_CHAT_PRESETS.find((preset) => preset.id === presetId);
}

export const PUBLIC_CHAT_TOOL_DISPLAY_LABELS: Record<
  PublicChatAllowedTool,
  string
> = {
  get_user_session: "Leagues",
  get_ancient_history: "League History",
  get_league_info: "League Info",
  get_standings: "Standings",
  get_matchups: "Matchups",
  get_roster: "Roster",
  get_free_agents: "Free Agents",
  get_players: "Player Lookup",
  get_transactions: "Transactions",
};
