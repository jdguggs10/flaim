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

export const PUBLIC_DEMO_PROMPT_VERSION = "v3";
export const PUBLIC_DEMO_CONTEXT_VERSION = "v2";

export const PUBLIC_CHAT_SIMPLE_PRESETS: readonly PublicChatPreset[] = [
  {
    id: "hot-hands",
    title: "Who is the hottest hitter and pitcher on Gerry's team?",
    userMessage: "Who is the hottest hitter and pitcher on Gerry's team?",
    allowedTools: ["get_roster"] as const,
    rail: "top",
  },
  {
    id: "league-format",
    title: "What kind of league is this?",
    userMessage: "What kind of league is this?",
    allowedTools: ["get_league_info"] as const,
    rail: "top",
  },
  {
    id: "quick-start",
    title: "Is Gerry off to a good start?",
    userMessage: "Is Gerry off to a good start?",
    allowedTools: ["get_standings"] as const,
    rail: "top",
  },
  {
    id: "this-matchup",
    title: "Who is Gerry facing, and what matters most?",
    userMessage: "Who is Gerry facing, and what matters most?",
    allowedTools: ["get_matchups"] as const,
    rail: "top",
  },
  {
    id: "team-leaders",
    title: "Who's carrying Gerry's team right now?",
    userMessage: "Who's carrying Gerry's team right now?",
    allowedTools: ["get_roster"] as const,
    rail: "top",
  },
  {
    id: "best-add",
    title: "What's the smartest waiver move right now?",
    userMessage: "What's the smartest waiver move right now?",
    allowedTools: ["get_free_agents"] as const,
    rail: "top",
  },
  {
    id: "bad-trend",
    title: "Who on Gerry's team is trending the wrong way?",
    userMessage: "Who on Gerry's team is trending the wrong way?",
    allowedTools: ["get_roster", "get_players"] as const,
    rail: "top",
  },
  {
    id: "my-moves",
    title: "Which league move actually matters?",
    userMessage: "Which league move actually matters?",
    allowedTools: ["get_transactions"] as const,
    rail: "top",
  },
  {
    id: "win-history",
    title: "Has Gerry ever won this thing?",
    userMessage: "Has Gerry ever won this thing?",
    allowedTools: ["get_ancient_history"] as const,
    rail: "top",
  },
] as const;

export const PUBLIC_CHAT_DEEP_PRESETS: readonly PublicChatPreset[] = [
  {
    id: "wire-watch",
    rail: "bottom",
    title: "Who are the best available free agents in Gerry's league?",
    userMessage: "Who are the best available free agents in Gerry's league?",
    allowedTools: ["get_roster", "get_free_agents", "get_players"] as const,
  },
  {
    id: "league-moves",
    rail: "bottom",
    title: "What moves were made in Gerry's league last night?",
    userMessage: "What moves were made in Gerry's league last night?",
    allowedTools: ["get_transactions", "get_players"] as const,
  },
  {
    id: "league-leader",
    rail: "bottom",
    title: "Who is winning Gerry's league and why?",
    userMessage: "Who is winning Gerry's league and why?",
    allowedTools: ["get_standings", "get_roster", "get_matchups"] as const,
  },
  {
    id: "drop-target",
    rail: "bottom",
    title: "What player does he need to give up on?",
    userMessage: "What player does he need to give up on?",
    allowedTools: ["get_roster", "get_players"] as const,
  },
  {
    id: "roster-hole",
    rail: "bottom",
    title: "What is the biggest hole in his roster?",
    userMessage: "What is the biggest hole in Gerry's roster?",
    allowedTools: ["get_league_info", "get_roster", "get_free_agents", "get_players"] as const,
  },
  {
    id: "sell-high",
    rail: "bottom",
    title: "Who should Gerry be selling high on?",
    userMessage: "Who should Gerry be selling high on?",
    allowedTools: ["get_roster", "get_players"] as const,
  },
  {
    id: "last-season",
    rail: "bottom",
    title: "How did he do last season?",
    userMessage: "How did he do last season?",
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
