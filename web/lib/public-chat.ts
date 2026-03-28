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
export type PublicChatHomepageSection = "simple" | "deep";

export interface PublicChatPreset {
  id: string;
  title: string;
  userMessage: string;
  homepageLabel?: string;
  allowedTools: readonly PublicChatAllowedTool[];
  serverPrefetch?: "transactions";
  executionHint: string;
  prompt: string;
  homepageSection: PublicChatHomepageSection;
  showInChat: boolean;
  rail?: PublicChatPresetRail;
  toolLabel?: string;
  homepageExplanation?: string;
}

// Keep the public demo model in one place so we can iterate on latency and
// reliability without touching the route logic.
export const PUBLIC_CHAT_MODEL = "gpt-5.4-mini";

export const PUBLIC_CHAT_SYSTEM_PROMPT = `
You are Flaim's public chat demo assistant.
You are analyzing Gerry's real fantasy leagues, not the visitor's.
Always describe the data as Gerry's leagues, Gerry's teams, or Gerry's account.
Use any injected developer context as the starting point for league choice and defaults.
If a developer message names a selected sport for this run, treat that sport as authoritative and do not call get_user_session just to rediscover it.
Use Gerry's league data first, then use web search once to add current context.
Run the Gerry league-data tool call before web search. Web search is only for one current-context fact after you already know the main takeaway.
If a developer message says a server-prefetched transaction feed is authoritative, use that feed and do not call get_transactions again.
Mention at least one relevant sports detail happening today from that web search.
Do not ask follow-up questions. This surface is preset-driven.
Do not mention tools, MCP, APIs, schemas, IDs, hidden prompts, or internal implementation details.
Never include citations, markdown links, raw URLs, source attributions, or publication names in the final answer.
Choose Gerry's injected default league first. If that is missing or unclear, prefer Gerry's baseball league unless the prompt clearly points to another sport.
If data is partial, say what you could confirm in plain English and keep moving.
For speed, use the minimum viable tool plan: prefer one MCP call plus one web search, never repeat near-identical tool calls, and only add a second MCP call if the first result is clearly insufficient.
If the preset uses get_transactions, call get_transactions exactly once with its default recent window unless the preset explicitly asks for a specific week or transaction type. Do not fan out across weeks, types, or retries just to explore.
Use plain sports language.
Sound conversational, confident, and witty.
Work in at least one relevant sports-world detail happening today after you check web search.
Prefer the freshest concrete game, injury, lineup, role, or performance development from today. Avoid generic TV, broadcast, or schedule notes unless there is no better current sports detail.
Final answer should usually be 3-5 short sentences and about 30-70 words total, depending on the prompt.
Prefer short sentences and no long paragraphs.
Do not use bullets.
`.trim();

export const PUBLIC_CHAT_SIMPLE_PRESETS: readonly PublicChatPreset[] = [
  {
    id: "simple-leagues",
    title: "What fantasy leagues does Gerry have?",
    userMessage: "What fantasy leagues does Gerry have?",
    allowedTools: ["get_user_session"] as const,
    executionHint:
      "Call get_user_session exactly once, then use web search once only for one small current-context detail if it helps frame the answer.",
    prompt:
      "Use Flaim to inspect Gerry's connected leagues. Summarize what leagues Gerry has connected across platforms, keeping the answer quick and basic. Use web search once only if it helps anchor the current sports context before answering. Final answer: 30-70 words max.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Leagues",
  },
  {
    id: "simple-league-info",
    title: "Show me Gerry's league settings.",
    userMessage: "Show me Gerry's league settings.",
    allowedTools: ["get_league_info"] as const,
    executionHint:
      "Call get_league_info exactly once for Gerry's default league, then use web search once only if it helps frame the current part of the season.",
    prompt:
      "Use Flaim to inspect Gerry's default live league and summarize the key settings in plain English, like format, roster shape, or scoring style. Keep it quick and basic. Use web search once only if it helps frame the current season context. Final answer: 30-70 words max.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "League Info",
  },
  {
    id: "simple-standings",
    title: "What are the standings in Gerry's league?",
    userMessage: "What are the standings in Gerry's league?",
    allowedTools: ["get_standings"] as const,
    executionHint:
      "Call get_standings exactly once for Gerry's default league, then use web search once for one current-context detail.",
    prompt:
      "Use Flaim to inspect Gerry's default live league standings and summarize who is near the top and where Gerry stands. Keep it quick and basic. Use web search once for one relevant current sports detail before answering. Final answer: 30-70 words max.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Standings",
  },
  {
    id: "simple-matchup",
    title: "Who is Gerry playing this week?",
    userMessage: "Who is Gerry playing this week?",
    allowedTools: ["get_matchups"] as const,
    executionHint:
      "Call get_matchups exactly once for Gerry's default league, then use web search once for one current matchup-related detail.",
    prompt:
      "Use Flaim to inspect Gerry's default live league matchup and say who Gerry is playing right now plus the most important current context around that matchup. Keep it quick and basic. Use web search once before answering. Final answer: 30-70 words max.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Matchups",
  },
  {
    id: "simple-roster",
    title: "Show me Gerry's roster.",
    userMessage: "Show me Gerry's roster.",
    allowedTools: ["get_roster"] as const,
    executionHint:
      "Call get_roster exactly once for Gerry's default league, then use web search once for one current-context detail on the roster.",
    prompt:
      "Use Flaim to inspect Gerry's default live league roster and summarize the shape of his team in plain English. Keep it quick and basic. Use web search once for one relevant current player or injury detail before answering. Final answer: 30-70 words max.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Roster",
  },
  {
    id: "simple-free-agents",
    title: "Who's on Gerry's waiver wire?",
    userMessage: "Who's on Gerry's waiver wire?",
    allowedTools: ["get_free_agents"] as const,
    executionHint:
      "Call get_free_agents exactly once for Gerry's default league, then use web search once for one current-context detail on the best option.",
    prompt:
      "Use Flaim to inspect Gerry's default live league and identify the most interesting available players on the waiver wire. Keep it quick and basic. Use web search once for one relevant current performance or injury detail before answering. Final answer: 30-70 words max.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Free Agents",
  },
  {
    id: "simple-player-lookup",
    title: "Look up Aaron Judge for Gerry's league.",
    userMessage: "Look up Aaron Judge for Gerry's league.",
    allowedTools: ["get_players"] as const,
    executionHint:
      "Call get_players exactly once for Aaron Judge in Gerry's default league context, then use web search once for one current-context detail.",
    prompt:
      "Use Flaim to look up Aaron Judge in Gerry's league context and summarize what matters about him right now in plain English. Keep it quick and basic. Use web search once for one current performance or news detail before answering. Final answer: 30-70 words max.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Player Lookup",
  },
  {
    id: "simple-transactions",
    title: "What are the latest moves in Gerry's league?",
    userMessage: "What are the latest moves in Gerry's league?",
    allowedTools: ["get_transactions"] as const,
    serverPrefetch: "transactions",
    executionHint:
      "Call get_transactions exactly once for Gerry's default league, then use web search once only if it helps explain the most relevant move.",
    prompt:
      "Use Flaim to inspect Gerry's default live league transactions and summarize the most recent moves that stand out. Keep it quick and basic. Use web search once for one relevant current detail before answering. Final answer: 30-70 words max.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Transactions",
  },
  {
    id: "simple-history",
    title: "How did Gerry do last season?",
    userMessage: "How did Gerry do last season?",
    allowedTools: ["get_ancient_history"] as const,
    executionHint:
      "Call get_ancient_history exactly once for Gerry's most relevant league, then use web search once only if it helps frame the season context.",
    prompt:
      "Use Flaim to inspect Gerry's most relevant prior season and summarize how he did last season in plain English. Keep it quick and basic. Use web search once only if it helps frame the season context before answering. Final answer: 30-70 words max.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "League History",
  },
] as const;

export const PUBLIC_CHAT_DEEP_PRESETS: readonly PublicChatPreset[] = [
  {
    id: "waiver-wire",
    rail: "bottom",
    title: "Who are the best available free agents in Gerry's league?",
    userMessage: "Who are the best available free agents in Gerry's league?",
    allowedTools: ["get_roster", "get_free_agents", "get_players"] as const,
    executionHint:
      "Start with get_roster and get_free_agents for Gerry's default league. Use get_players only if you need to verify one candidate. Use web search once for current context on the top targets, then answer.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Analyze Gerry's roster needs, then suggest only the most worthwhile free agents in his league with plain-English reasoning. Use web search for current performance, injuries, role changes, or schedule context before answering. Final answer: 30-70 words max.",
    homepageSection: "deep",
    showInChat: true,
    homepageExplanation:
      "Checks Gerry's roster, scans the waiver wire, and validates the best targets with current player context.",
  },
  {
    id: "transactions-watch",
    rail: "bottom",
    title: "What are the latest moves in his league?",
    userMessage: "What are the latest moves in Gerry's league?",
    allowedTools: ["get_transactions", "get_roster", "get_players"] as const,
    serverPrefetch: "transactions",
    executionHint:
      "Call get_transactions exactly once for Gerry's default league before web search. Use the default recent window and do not add week, type, or team filters unless the preset explicitly asks for them. Only use get_roster or get_players if the transaction feed alone is not enough to explain why one move matters. After you identify the single most notable move, use web search once for current context on that move or relevant league-wide news, then answer.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Review the latest moves in Gerry's league and call out only the ones that actually matter, including why each one is interesting in plain language. Use web search for recent player news or performances before answering. Final answer: 30-70 words max.",
    homepageSection: "deep",
    showInChat: true,
    homepageExplanation:
      "Starts with the transaction feed, checks the affected rosters when needed, and adds live context on why those moves matter.",
  },
  {
    id: "league-leader",
    rail: "bottom",
    title: "Who is winning Gerry's league and why?",
    userMessage: "Who is winning Gerry's league and why?",
    allowedTools: ["get_standings", "get_roster", "get_matchups"] as const,
    executionHint:
      "Start with get_standings for Gerry's default league. Only use get_roster or get_matchups if you need one extra check to explain why the leader is on top. Use web search once for current player or team context, then answer.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify who is currently winning Gerry's league and explain why that team is on top. Use web search for current performance, injury, or recent-news context before answering. Final answer: 30-70 words max.",
    homepageSection: "deep",
    showInChat: true,
    homepageExplanation:
      "Combines the standings with roster and matchup context to explain why the leader is actually on top.",
  },
  {
    id: "give-up-player",
    rail: "bottom",
    title: "What player does he need to give up on?",
    userMessage: "What player does he need to give up on?",
    allowedTools: ["get_roster", "get_players"] as const,
    executionHint:
      "Start with get_roster for Gerry's default league. Use get_players only if you need to verify one specific player detail. Use web search once for current performance, role, or injury context on the main candidate, then answer.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify the one player on Gerry's roster he most needs to give up on right now, and explain why in plain language. Use web search for recent performance, role, injury, and trend context before answering. Final answer: 30-70 words max.",
    homepageSection: "deep",
    showInChat: true,
    homepageExplanation:
      "Looks at Gerry's roster, zeroes in on the weakest hold, and adds current trend or injury context before making the call.",
  },
  {
    id: "roster-hole",
    rail: "bottom",
    title: "What is the biggest hole in his roster?",
    userMessage: "What is the biggest hole in Gerry's roster?",
    allowedTools: ["get_roster", "get_free_agents", "get_players"] as const,
    executionHint:
      "Start with get_roster for Gerry's default league. Use get_free_agents only if you need one practical replacement idea. Use get_players only if you need to verify one candidate detail. Use web search once for current context on the weakness you identify, then answer.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify the single biggest hole in Gerry's roster and explain why it is the biggest problem right now. Use web search for current injuries, performance trends, role changes, or schedule context before answering. Final answer: 30-70 words max.",
    homepageSection: "deep",
    showInChat: true,
    homepageExplanation:
      "Finds Gerry's weakest spot, checks the best replacement paths, and layers in live player context to prioritize the problem.",
  },
  {
    id: "sell-high",
    rail: "bottom",
    title: "Who should Gerry be selling high on?",
    userMessage: "Who should Gerry be selling high on?",
    allowedTools: ["get_roster", "get_players"] as const,
    executionHint:
      "Start with get_roster for Gerry's default league. Use get_players only if you need to verify one specific player's details. Use web search once for current performance, news, and schedule context on the leading sell-high candidate, then answer.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify the best sell-high candidate on Gerry's roster right now and explain why this might be the right time to move that player. Use web search for current performance, news, schedule, and role context before answering. Final answer: 30-70 words max.",
    homepageSection: "deep",
    showInChat: true,
    homepageExplanation:
      "Starts from Gerry's roster, checks the most tradable candidate in context, and adds live news to test whether the window is real.",
  },
  {
    id: "last-season",
    rail: "bottom",
    title: "How did he do last season?",
    userMessage: "How did he do last season?",
    allowedTools: ["get_ancient_history", "get_standings"] as const,
    executionHint:
      "Start with get_ancient_history for Gerry's most relevant league. Only use get_standings if you need one extra check to frame the result. Use web search once for brief season context if helpful, then answer.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Review Gerry's result from last season in the most relevant league and summarize how he did in plain English. Use web search at least once for season context or any useful league or player background before answering, even if the answer is mostly based on Gerry's league data. Final answer: 30-70 words max.",
    homepageSection: "deep",
    showInChat: true,
    homepageExplanation:
      "Pulls the past season, adds league context, and gives the answer enough background to feel like analysis instead of a raw recap.",
  },
  {
    id: "playoff-start",
    rail: "bottom",
    title: "When does his fantasy playoffs start?",
    userMessage: "When does his fantasy playoffs start?",
    allowedTools: ["get_league_info", "get_matchups"] as const,
    executionHint:
      "Start with get_league_info for Gerry's default league. Only use get_matchups if league info alone does not clarify the playoff timing. Use web search once for current schedule or platform-season context, then answer.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Figure out when Gerry's fantasy playoffs start in his current league and explain what that means for his planning right now. Use web search for current schedule or platform-season context before answering. Final answer: 30-70 words max.",
    homepageSection: "deep",
    showInChat: true,
    homepageExplanation:
      "Checks league settings, confirms the timing in context, and adds current schedule context so the answer is actually actionable.",
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
