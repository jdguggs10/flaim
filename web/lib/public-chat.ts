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

export const PUBLIC_DEMO_PROMPT_VERSION = "v5";
export const PUBLIC_DEMO_CONTEXT_VERSION = "v2";

export const PUBLIC_CHAT_SIMPLE_PRESETS: readonly PublicChatPreset[] = [
  {
    id: "hot-hands",
    title: "What are the top players on my team?",
    userMessage: "What are the top players on my team?",
    allowedTools: ["get_roster"] as const,
    rail: "top",
  },
  {
    id: "league-format",
    title: "Tell me my league settings.",
    userMessage: "Tell me my league settings.",
    allowedTools: ["get_league_info"] as const,
    rail: "top",
  },
  {
    id: "this-matchup",
    title: "Who is winning my matchup?",
    userMessage: "Who is winning my matchup?",
    allowedTools: ["get_matchups", "get_roster"] as const,
    rail: "top",
  },
  {
    id: "my-moves",
    title: "Show me my recent moves.",
    userMessage: "Show me my recent moves.",
    allowedTools: ["get_transactions"] as const,
    rail: "top",
  },
  {
    id: "win-history",
    title: "Have I ever won the championship?",
    userMessage: "Have I ever won the championship?",
    allowedTools: ["get_ancient_history", "get_matchups"] as const,
    rail: "top",
  },
  {
    id: "trade-grades",
    title: "Grade my last trade.",
    userMessage: "Grade my last trade.",
    allowedTools: ["get_transactions"] as const,
    rail: "top",
  },
] as const;

export const PUBLIC_CHAT_DEEP_PRESETS: readonly PublicChatPreset[] = [
  {
    id: "wire-watch",
    rail: "bottom",
    title: "Who should I add and drop?",
    userMessage: "Who should I add and drop?",
    allowedTools: ["get_roster", "get_free_agents", "get_players"] as const,
  },
  {
    id: "league-moves",
    rail: "bottom",
    title: "What happened in my league last night?",
    userMessage: "What happened in my league last night?",
    allowedTools: ["get_transactions", "get_players"] as const,
  },
  {
    id: "roster-hole",
    rail: "bottom",
    title: "What is my team's biggest roster construction problem?",
    userMessage: "What is my team's biggest roster construction problem?",
    allowedTools: ["get_roster"] as const,
  },
  {
    id: "sell-high",
    rail: "bottom",
    title: "Who should I buy low and sell high on?",
    userMessage: "Who should I buy low and sell high on?",
    allowedTools: ["get_roster", "get_free_agents", "get_matchups"] as const,
  },
  {
    id: "best-team",
    rail: "bottom",
    title: "Do I have the best team in the league?",
    userMessage: "Do I have the best team in the league?",
    allowedTools: ["get_standings", "get_roster"] as const,
  },
  {
    id: "start-sit",
    rail: "bottom",
    title: "Who should I start or stream today?",
    userMessage: "Who should I start or stream today?",
    allowedTools: ["get_roster", "get_matchups", "get_free_agents"] as const,
  },
] as const;

/** Presets retained for future reuse but excluded from the active homepage demo. */
export const PUBLIC_CHAT_BENCHED_PRESETS: readonly PublicChatPreset[] = [
  {
    id: "drop-target",
    rail: "bottom",
    title: "Who should I consider cutting?",
    userMessage: "Who should I consider cutting?",
    allowedTools: ["get_roster", "get_players"] as const,
  },
  {
    id: "last-season",
    rail: "bottom",
    title: "How did I do last season?",
    userMessage: "How did I do last season?",
    allowedTools: ["get_ancient_history", "get_standings"] as const,
  },
  {
    id: "quick-start",
    title: "Am I off to a good start?",
    userMessage: "Am I off to a good start?",
    allowedTools: ["get_standings"] as const,
    rail: "top",
  },
  {
    id: "league-leader",
    rail: "bottom",
    title: "Who is winning our league and why?",
    userMessage: "Who is winning our league and why?",
    allowedTools: ["get_standings", "get_roster", "get_matchups"] as const,
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
