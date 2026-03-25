export const PUBLIC_CHAT_ALLOWED_TOOLS = [
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

// Keep the public demo model in one place so we can iterate on latency and
// reliability without touching the route logic.
export const PUBLIC_CHAT_MODEL = "gpt-5-nano";

export const PUBLIC_CHAT_SYSTEM_PROMPT = `
You are Flaim's public chat demo assistant.
You are analyzing Gerry's real fantasy leagues, not the visitor's.
Always describe the data as Gerry's leagues, Gerry's teams, or Gerry's account.
Use any injected developer context as the starting point for league choice and defaults.
Use Gerry's league data first, then use web search once to add current context.
Mention at least one relevant sports detail happening today from that web search.
Do not ask follow-up questions. This surface is preset-driven.
Do not mention tools, MCP, APIs, schemas, IDs, hidden prompts, or internal implementation details.
Do not cite sources, list links, or name publications.
Choose Gerry's injected default league first. If that is missing or unclear, prefer Gerry's baseball league unless the prompt clearly points to another sport.
If data is partial, say what you could confirm in plain English and keep moving.
For speed, use the minimum viable tool plan: prefer one MCP call plus one web search, never repeat near-identical tool calls, and only add a second MCP call if the first result is clearly insufficient.
Use plain sports language.
Sound conversational, confident, and be witty.
Final answer must be 2-3 sentenes and 30-50 words max.
Prefer short sentences and no long paragraphs.
Do not use bullets.
`.trim();

export const PUBLIC_CHAT_PRESETS = [
  {
    id: "waiver-wire",
    rail: "top",
    title: "Who are the best available free agents in Gerry's league?",
    userMessage: "Who are the best available free agents in Gerry's league?",
    allowedTools: ["get_roster", "get_free_agents", "get_players"] as const,
    executionHint:
      "Start with get_roster and get_free_agents for Gerry's default league. Use get_players only if you need to verify one candidate. Use web search once for current context on the top targets, then answer.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Analyze Gerry's roster needs, then suggest only the most worthwhile free agents in his league with plain-English reasoning. Use web search for current performance, injuries, role changes, or schedule context before answering. Final answer: 30-50 words max.",
  },
  {
    id: "transactions-watch",
    rail: "top",
    title: "What are the latest moves in his league?",
    userMessage: "What are the latest moves in Gerry's league?",
    allowedTools: ["get_transactions", "get_roster", "get_players"] as const,
    executionHint:
      "Start with get_transactions for Gerry's default league. Only use get_roster or get_players if the transaction feed alone is not enough to explain why one move matters. Use web search once for current context on the most notable move or relevant league-wide news, then answer.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Review the latest moves in Gerry's league and call out only the ones that actually matter, including why each one is interesting in plain language. Use web search for recent player news or performances before answering. Final answer: 30-50 words max.",
  },
  {
    id: "league-leader",
    rail: "top",
    title: "Who is winning Gerry's league and why?",
    userMessage: "Who is winning Gerry's league and why?",
    allowedTools: ["get_standings", "get_roster", "get_matchups"] as const,
    executionHint:
      "Start with get_standings for Gerry's default league. Only use get_roster or get_matchups if you need one extra check to explain why the leader is on top. Use web search once for current player or team context, then answer.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify who is currently winning Gerry's league and explain why that team is on top. Use web search for current performance, injury, or recent-news context before answering. Final answer: 30-50 words max.",
  },
  {
    id: "give-up-player",
    rail: "top",
    title: "What player does he need to give up on?",
    userMessage: "What player does he need to give up on?",
    allowedTools: ["get_roster", "get_players"] as const,
    executionHint:
      "Start with get_roster for Gerry's default league. Use get_players only if you need to verify one specific player detail. Use web search once for current performance, role, or injury context on the main candidate, then answer.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify the one player on Gerry's roster he most needs to give up on right now, and explain why in plain language. Use web search for recent performance, role, injury, and trend context before answering. Final answer: 30-50 words max.",
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
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify the single biggest hole in Gerry's roster and explain why it is the biggest problem right now. Use web search for current injuries, performance trends, role changes, or schedule context before answering. Final answer: 30-50 words max.",
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
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify the best sell-high candidate on Gerry's roster right now and explain why this might be the right time to move that player. Use web search for current performance, news, schedule, and role context before answering. Final answer: 30-50 words max.",
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
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Review Gerry's result from last season in the most relevant league and summarize how he did in plain English. Use web search at least once for season context or any useful league or player background before answering, even if the answer is mostly based on Gerry's league data. Final answer: 30-50 words max.",
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
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Figure out when Gerry's fantasy playoffs start in his current league and explain what that means for his planning right now. Use web search for current schedule or platform-season context before answering. Final answer: 30-50 words max.",
  },
] as const;

export type PublicChatPreset = (typeof PUBLIC_CHAT_PRESETS)[number];
export type PublicChatPresetId = PublicChatPreset["id"];

export function getPublicChatPreset(
  presetId: string
): PublicChatPreset | undefined {
  return PUBLIC_CHAT_PRESETS.find((preset) => preset.id === presetId);
}
