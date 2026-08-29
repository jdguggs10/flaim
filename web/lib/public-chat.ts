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

export const PUBLIC_DEMO_PROMPT_VERSION = "v7";
export const PUBLIC_DEMO_CONTEXT_VERSION = "v2";

export type PublicChatDemoPlatform = "espn" | "yahoo" | "sleeper";

export function isPublicChatDemoPlatform(
  value: unknown,
): value is PublicChatDemoPlatform {
  return value === "espn" || value === "yahoo" || value === "sleeper";
}

export function isPublicChatDemoSport(
  value: unknown,
): value is PublicChatDemoSport {
  return value === "football" || value === "baseball";
}

/**
 * Version tags for the platform-aware ("target") demo cache rows, which use a
 * six-segment cache key. These are new constants for the multi-platform demo;
 * the legacy v7/v2 constants above stay untouched for the one-release
 * espn-baseball fallback window.
 */
export const PUBLIC_DEMO_TARGET_PROMPT_VERSION = "v8";
export const PUBLIC_DEMO_TARGET_CONTEXT_VERSION = "v3";

/** The eight cross-target presets every platform/sport demo target serves. */
export const PUBLIC_CHAT_TARGET_PRESET_IDS = [
  "hot-hands",
  "league-format",
  "this-matchup",
  "my-moves",
  "best-team",
  "wire-watch",
  "league-moves",
  "roster-hole",
] as const;

export type PublicChatTargetPresetId =
  (typeof PUBLIC_CHAT_TARGET_PRESET_IDS)[number];

export interface PublicChatTarget {
  platform: PublicChatDemoPlatform;
  sport: PublicChatDemoSport;
  presetIds: readonly PublicChatTargetPresetId[];
  /** Deterministic sport shown first when this platform is selected. */
  isDefaultSport: boolean;
}

/**
 * Supported platform/sport demo targets, in deterministic order. The first
 * selectable entry in this order is the overall default target.
 * sleeper-football leads for the 2026 football draft season, so the site
 * defaults to it the moment that lane becomes selectable; until then
 * espn-baseball (next in order) stays the default. Revisit this ordering at
 * the FLA-253 season rollover. Default sports per platform: espn baseball
 * (for now), yahoo baseball, sleeper football.
 */
export const PUBLIC_CHAT_TARGET_MATRIX: readonly PublicChatTarget[] = [
  {
    platform: "sleeper",
    sport: "football",
    presetIds: PUBLIC_CHAT_TARGET_PRESET_IDS,
    isDefaultSport: true,
  },
  {
    platform: "espn",
    sport: "baseball",
    presetIds: PUBLIC_CHAT_TARGET_PRESET_IDS,
    isDefaultSport: true,
  },
  {
    platform: "espn",
    sport: "football",
    presetIds: PUBLIC_CHAT_TARGET_PRESET_IDS,
    isDefaultSport: false,
  },
  {
    platform: "yahoo",
    sport: "baseball",
    presetIds: PUBLIC_CHAT_TARGET_PRESET_IDS,
    isDefaultSport: true,
  },
  {
    platform: "yahoo",
    sport: "football",
    presetIds: PUBLIC_CHAT_TARGET_PRESET_IDS,
    isDefaultSport: false,
  },
] as const;

export function getPublicChatTarget(
  platform: PublicChatDemoPlatform,
  sport: PublicChatDemoSport,
): PublicChatTarget | undefined {
  return PUBLIC_CHAT_TARGET_MATRIX.find(
    (target) => target.platform === platform && target.sport === sport,
  );
}

export const PUBLIC_CHAT_SIMPLE_PRESETS: readonly PublicChatPreset[] = [
  {
    id: "hot-hands",
    title: "Who are his best players?",
    userMessage: "Who are his best players?",
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
    id: "this-matchup",
    title: "How is his matchup?",
    userMessage: "How is his matchup?",
    allowedTools: ["get_matchups", "get_roster"] as const,
    rail: "top",
  },
  {
    id: "my-moves",
    title: "Show me his recent moves.",
    userMessage: "Show me his recent moves.",
    allowedTools: ["get_transactions"] as const,
    rail: "top",
  },
  // win-history, trade-grades, sell-high, and start-sit intentionally keep
  // their first-person copy: they leave the picker when the platform/sport
  // capability wiring lands (FLA-247), so they are not part of the
  // third-person reword.
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
    title: "Give me his best wire add.",
    userMessage: "Give me his best wire add.",
    allowedTools: ["get_roster", "get_free_agents", "get_players"] as const,
  },
  {
    id: "league-moves",
    rail: "bottom",
    title: "Summarize yesterday's league activity.",
    userMessage: "Summarize yesterday's league activity.",
    allowedTools: ["get_transactions", "get_players"] as const,
  },
  {
    id: "roster-hole",
    rail: "bottom",
    title: "What is his biggest roster hole?",
    userMessage: "What is his biggest roster hole?",
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
    title: "Who has the best team?",
    userMessage: "Who has the best team?",
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
  get_free_agents: "Available Players",
  get_players: "Player Lookup",
  get_transactions: "Transactions",
};
