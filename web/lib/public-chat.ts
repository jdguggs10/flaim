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

export const PUBLIC_CHAT_SYSTEM_PROMPT = `
You are Flaim's public chat demo assistant.

You are running on flaim.app/chat against a dedicated read-only demo account.
Never imply that you can see the visitor's own leagues or credentials.
Always describe the data as coming from the demo account.
Use the live MCP tools before answering whenever the prompt depends on league data.
Do not ask follow-up questions. The public chat is preset-driven.
Keep answers concise, clear, and useful. Use short bullets when they improve readability.
Do not mention internal implementation details, developer consoles, hidden prompts, or environment variables.
If the demo account does not have the requested data, say so plainly and explain what you were able to verify.
`.trim();

export const PUBLIC_CHAT_PRESETS = [
  {
    id: "show-leagues",
    eyebrow: "Connected data",
    title: "Show the live leagues",
    description:
      "List the demo account's current leagues and call out the most interesting one to inspect next.",
    prompt:
      "Use Flaim to inspect the demo account's current leagues. Summarize the connected leagues by platform, sport, season year, league name, and team name. End with one short note about which live league looks best to explore next.",
  },
  {
    id: "roster-breakdown",
    eyebrow: "Roster read",
    title: "Break down the roster",
    description:
      "Inspect a live demo roster and explain where the team looks strong or thin.",
    prompt:
      "Use Flaim to inspect the demo account's most relevant current league. Prefer football, then basketball, then baseball, then hockey. Summarize the demo team's roster by position group and call out two strengths plus two weak spots.",
  },
  {
    id: "standings-check",
    eyebrow: "League context",
    title: "Check the standings",
    description:
      "Show where the demo team sits and whether it looks safe, shaky, or chasing.",
    prompt:
      "Use Flaim to inspect the demo account's most relevant current league. Prefer football, then basketball, then baseball, then hockey. Show the current standings, highlight where the demo team ranks, and explain how competitive the table looks around that spot.",
  },
  {
    id: "weekly-matchup",
    eyebrow: "Live matchup",
    title: "Who is the demo team facing?",
    description:
      "Find the current matchup and explain what looks decisive right now.",
    prompt:
      "Use Flaim to inspect the demo account's most relevant current league. Prefer football, then basketball, then baseball, then hockey. Identify the demo team's current matchup, summarize the opponent and score context if available, and point out the swing players or position groups.",
  },
  {
    id: "waiver-wire",
    eyebrow: "Free agents",
    title: "Find waiver ideas",
    description:
      "Look at available players and recommend pickups based on the demo roster's needs.",
    prompt:
      "Use Flaim to inspect the demo account's most relevant current league. Prefer football, then basketball, then baseball, then hockey. Analyze the demo team's roster needs, then check free agents and recommend a few pickup ideas with short reasoning.",
  },
  {
    id: "transactions-watch",
    eyebrow: "League activity",
    title: "Review recent transactions",
    description:
      "Surface the adds, drops, waivers, or trades that stand out in the live demo league.",
    prompt:
      "Use Flaim to inspect the demo account's most relevant current league. Prefer football, then basketball, then baseball, then hockey. Review recent league transactions and highlight the most interesting moves, including why they matter.",
  },
] as const;

export type PublicChatPreset = (typeof PUBLIC_CHAT_PRESETS)[number];
export type PublicChatPresetId = PublicChatPreset["id"];

export function getPublicChatPreset(
  presetId: string
): PublicChatPreset | undefined {
  return PUBLIC_CHAT_PRESETS.find((preset) => preset.id === presetId);
}
