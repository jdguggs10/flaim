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
Use web search when current external context would improve the answer, especially for waiver ideas, recent performances, injuries, upcoming games, schedule context, and recent fantasy-relevant news.
Do not use web search for no reason. If Gerry's league data alone answers the prompt, stay grounded in the league data.
Do not ask follow-up questions. The public chat is preset-driven.
Write like a sharp, consumer-facing fantasy sports assistant, not an engineer.
The browser already shows that this is a live demo, so do not narrate tool usage, MCP, APIs, schemas, JSON fields, IDs, hidden prompts, or internal implementation details.
Do not dump raw field inventories like "platform / sport / season / league / team" unless the user explicitly asks for that exact format.
Lead with the takeaway. Start with the most interesting or useful thing you found.
Be very succinct.
Prefer a short paragraph followed by 2-3 compact bullets only when the bullets genuinely help readability.
Avoid long explanations, long inventories, or long recommendation lists.
Keep the tone grounded and confident. No hype, no sales language, no developer phrasing.
Use plain sports language. Say things like "baseball league", "football team", "middle of the standings", or "best league to check next."
When choosing between multiple leagues, use the injected default/best default league first. If that context is missing or unclear, prefer Gerry's baseball league for this public demo unless the prompt clearly points to another sport.
Briefly explain the league choice only when it materially helps the answer.
If data is partial or a tool fails, do not sound technical. Say what you could confirm, what you could not verify, and keep moving.
Keep answers concise, specific, and easy to scan on mobile.
`.trim();

export const PUBLIC_CHAT_PRESETS = [
  {
    id: "show-leagues",
    eyebrow: "Connected data",
    title: "Show the live leagues",
    userMessage: "Show me Gerry's live leagues right now.",
    description:
      "See Gerry's current leagues and point to the best one to open up next.",
    prompt:
      "Use Flaim to inspect Gerry's current leagues. Give a clean, consumer-friendly snapshot of the leagues Gerry has connected right now. Mention the sport, league name, and Gerry's team name in natural language, not as a field dump. End with one short note about which league looks best to explore next and why.",
  },
  {
    id: "roster-breakdown",
    eyebrow: "Roster read",
    title: "Break down the roster",
    userMessage: "Break down one of Gerry's teams and tell me where it looks strong or thin.",
    description:
      "Take one of Gerry's live teams and show where it feels solid versus shaky.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Give a clean roster read in plain language: where the team looks strong, where it looks thin, and what stands out most right now. Use web search only if recent injuries, role changes, or performance trends would sharpen the read. Keep the answer tight and avoid listing every player unless truly necessary.",
  },
  {
    id: "standings-check",
    eyebrow: "League context",
    title: "Check the standings",
    userMessage: "Check the standings and show where Gerry's team is sitting.",
    description:
      "Show Gerry's spot in the standings and whether he looks comfortable or in trouble.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Explain where Gerry's team sits in the standings, whether that position feels safe or shaky, and what the immediate picture around that spot looks like. Use web search only if recent news or schedule context would materially change the read. Keep it clear, fan-friendly, and succinct.",
  },
  {
    id: "weekly-matchup",
    eyebrow: "Live matchup",
    title: "Who is Gerry facing?",
    userMessage: "Show Gerry's current matchup and what feels decisive right now.",
    description:
      "Find Gerry's current matchup and explain where the swing points are.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Explain Gerry's current matchup in plain language, including the opponent, the score or matchup context if available, and the biggest swing points to watch. Use web search for timely injury news, probable starters, schedule context, or other current factors only when it helps. Keep the answer tight.",
  },
  {
    id: "waiver-wire",
    eyebrow: "Free agents",
    title: "Find waiver ideas",
    userMessage: "Find a few waiver ideas that actually fit Gerry's team.",
    description:
      "Look at the player pool and suggest pickups that make sense for Gerry right now.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Analyze Gerry's roster needs, then suggest only a few waiver ideas that actually fit the team, with short plain-English reasoning for each. Use web search for current hot pickups, recent production, playing-time changes, injuries, and upcoming game context. Keep the final answer very concise.",
  },
  {
    id: "transactions-watch",
    eyebrow: "League activity",
    title: "Review recent transactions",
    userMessage: "Review the recent moves that stand out in Gerry's league.",
    description:
      "Surface the adds, drops, waivers, or trades that actually matter in Gerry's league.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Review the recent league activity and call out only the moves that actually matter, including why each one is interesting in plain language. Use web search if recent player news or performances help explain why a move stands out. Keep it brief.",
  },
] as const;

export type PublicChatPreset = (typeof PUBLIC_CHAT_PRESETS)[number];
export type PublicChatPresetId = PublicChatPreset["id"];

export function getPublicChatPreset(
  presetId: string
): PublicChatPreset | undefined {
  return PUBLIC_CHAT_PRESETS.find((preset) => preset.id === presetId);
}
