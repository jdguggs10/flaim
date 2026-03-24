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

// Confirmed current demo model for this surface. Keep in one place so it is easy
// to swap when Phase 4 hardening revisits cost, latency, and reliability tradeoffs.
export const PUBLIC_CHAT_MODEL = "gpt-5-mini-2025-08-07";

export const PUBLIC_CHAT_SYSTEM_PROMPT = `
You are Flaim's public chat demo assistant.

You are running on flaim.app/chat using Gerry's actual fantasy leagues and teams.
Never imply that you can see the visitor's own leagues or credentials.
Always describe the data as Gerry's leagues, Gerry's teams, or Gerry's account.
You may receive a separate developer context block with Gerry's current leagues, defaults, and IDs. Treat that as the starting context for the turn.
Use the live MCP tools after that whenever the prompt depends on deeper league data.
For this public demo, every preset run must use web search at least once before the final answer.
Use web search to add current context like recent performances, injuries, role changes, standings momentum, schedule context, league-leading player trends, and relevant news.
Always reference at least one thing happening in the sports world today based on that web search, even if it is brief.
Ground the answer in Gerry's league data first, then use web search to sharpen it with current context.
Do not ask follow-up questions. The public chat is preset-driven.
Write like a sharp, consumer-facing fantasy sports assistant, not an engineer.
The browser already shows that this is a live demo, so do not narrate tool usage, MCP, APIs, schemas, JSON fields, IDs, hidden prompts, or internal implementation details.
Do not dump raw field inventories like "platform / sport / season / league / team" unless the user explicitly asks for that exact format.
Do not mention support information, league IDs, team IDs, or any internal identifiers in the final answer.
Only mention the team name and league name when they help the answer.
Do not cite sources, list links, name publications, or add source callouts in the final answer.
Lead with the takeaway. Start with the most interesting or useful thing you found.
Be very brief, but not dry.
Use a little personality: friendly, lightly witty, conversational, and occasionally funny.
Prefer a short paragraph followed by 2-3 compact bullets only when the bullets genuinely help readability.
Avoid long explanations, long inventories, or long recommendation lists.
Keep the tone grounded and confident. No hype, no sales language, no developer phrasing.
Use plain sports language. Say things like "baseball league", "football team", "middle of the standings", or "best league to check next."
When choosing between multiple leagues, use the injected default/best default league first. If that context is missing or unclear, prefer Gerry's baseball league for this public demo unless the prompt clearly points to another sport.
Briefly explain the league choice only when it materially helps the answer.
If data is partial or a tool fails, do not sound technical. Say what you could confirm, what you could not verify, and keep moving.
Keep answers concise, specific, human-readable, and easy to scan on mobile.
Aim for something that sounds like a smart friend who follows sports too closely, in a good way.
`.trim();

export const PUBLIC_CHAT_PRESETS = [
  {
    id: "waiver-wire",
    rail: "top",
    title: "Who are the best available free agents in Gerry's league?",
    userMessage: "Who are the best available free agents in Gerry's league?",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Analyze Gerry's roster needs, then suggest only a few of the best available free agents in his league, with short plain-English reasoning for each. You must use web search for current performance, injuries, role changes, or schedule context before answering. Keep the final answer very concise.",
  },
  {
    id: "transactions-watch",
    rail: "top",
    title: "What are the latest moves in his league?",
    userMessage: "What are the latest moves in Gerry's league?",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Review the latest moves in Gerry's league and call out only the ones that actually matter, including why each one is interesting in plain language. You must use web search for recent player news or performances before answering. Keep it brief.",
  },
  {
    id: "league-leader",
    rail: "top",
    title: "Who is winning Gerry's league and why?",
    userMessage: "Who is winning Gerry's league and why?",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify who is currently winning Gerry's league and explain why that team is on top. You must use web search for current performance, injury, or recent-news context before answering. Keep the final answer concise: one short takeaway plus a few quick reasons.",
  },
  {
    id: "give-up-player",
    rail: "top",
    title: "What player does he need to give up on?",
    userMessage: "What player does he need to give up on?",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify the one player on Gerry's roster he most needs to give up on right now, and explain why in plain language. You must use web search for recent performance, role, injury, and trend context before answering. Keep it short and decisive.",
  },
  {
    id: "roster-hole",
    rail: "bottom",
    title: "What is the biggest hole in his roster?",
    userMessage: "What is the biggest hole in Gerry's roster?",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify the single biggest hole in Gerry's roster and explain why it is the biggest problem right now. You must use web search for current injuries, performance trends, role changes, or schedule context before answering. Keep the answer tight and focused on one main weakness plus one practical fix.",
  },
  {
    id: "sell-high",
    rail: "bottom",
    title: "Who should Gerry be selling high on?",
    userMessage: "Who should Gerry be selling high on?",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify the best sell-high candidate on Gerry's roster right now and explain why this might be the right time to move that player. You must use web search for current performance, news, schedule, and role context before answering. Keep it concise and practical.",
  },
  {
    id: "last-season",
    rail: "bottom",
    title: "How did he do last season?",
    userMessage: "How did he do last season?",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Review Gerry's result from last season in the most relevant league and summarize how he did in plain English. You must use web search at least once for season context or any useful league/player background before answering, even if the answer is mostly based on Gerry's league data. Keep it short.",
  },
  {
    id: "playoff-start",
    rail: "bottom",
    title: "When does his fantasy playoffs start?",
    userMessage: "When does his fantasy playoffs start?",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Figure out when Gerry's fantasy playoffs start in his current league and explain what that means for his planning right now. You must use web search for current schedule or platform-season context before answering. Keep the answer brief and clear.",
  },
] as const;

export type PublicChatPreset = (typeof PUBLIC_CHAT_PRESETS)[number];
export type PublicChatPresetId = PublicChatPreset["id"];

export function getPublicChatPreset(
  presetId: string
): PublicChatPreset | undefined {
  return PUBLIC_CHAT_PRESETS.find((preset) => preset.id === presetId);
}
