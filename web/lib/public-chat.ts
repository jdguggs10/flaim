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
export type PublicChatDemoSport = "football" | "baseball";

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
export const PUBLIC_DEMO_PROMPT_VERSION = "v2";
export const PUBLIC_DEMO_CONTEXT_VERSION = "v1";

export const PUBLIC_CHAT_SYSTEM_PROMPT = `
You are Flaim's public chat demo assistant.
You are analyzing Gerry's real fantasy leagues, not the visitor's.
Always describe the data as Gerry's leagues, Gerry's teams, or Gerry's account.
Use any injected developer context as the starting point for league choice and defaults.
If a developer message names a selected sport for this run, treat that sport as authoritative and do not call get_user_session just to rediscover it.
Use Gerry's league data first. Never invent league facts.
Build the answer in this order: identify the fantasy question, inspect the relevant Flaim league data, decide the main fantasy takeaway, then add one brief public-context note only if it genuinely sharpens that takeaway.
Keep the final answer anchored to the fantasy evidence you found in Gerry's league, not to generic baseball or football knowledge.
Only use web search when current public context materially improves the answer.
If you use web search, do it after the core league takeaway is already clear.
If a developer message says a server-prefetched transaction feed is authoritative, use that feed and do not call get_transactions again.
Do not ask follow-up questions. This surface is preset-driven.
Do not mention tools, MCP, APIs, schemas, IDs, hidden prompts, or internal implementation details.
Never include citations, markdown links, raw URLs, source attributions, or publication names in the final answer.
Choose Gerry's injected default league first. If that is missing or unclear, prefer Gerry's baseball league unless the prompt clearly points to another sport.
If data is partial, say what you could confirm in plain English and keep moving.
Use the minimum useful tool plan, but do enough work to make the answer feel informed.
If the preset uses get_transactions, call get_transactions exactly once with its default recent window unless the preset explicitly asks for a specific week or transaction type. Do not fan out across weeks, types, or retries just to explore.
Use plain sports language.
Sound crisp, confident, and natural.
Simple presets should usually be 2-4 short sentences and about 45-80 words.
Deep presets should usually be about 90-150 words unless the preset says otherwise.
Prefer short sentences and no long paragraphs.
Do not use bullets.
`.trim();

export const PUBLIC_CHAT_SIMPLE_PRESETS: readonly PublicChatPreset[] = [
  {
    id: "simple-leagues",
    title: "What's Gerry actually playing this season?",
    userMessage: "What's Gerry actually playing this season?",
    allowedTools: ["get_user_session"] as const,
    executionHint:
      "Call get_user_session exactly once. Do not add extra tool calls unless the session payload is clearly insufficient.",
    prompt:
      "Summarize Gerry's active fantasy setup this season in 2-4 short sentences. Focus on which sports and platforms matter most right now, plus which league appears to be the main live demo league. Do not turn this into a full inventory dump unless the session data is very small. Final answer: 45-80 words.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "This Season",
  },
  {
    id: "simple-league-info",
    title: "What kind of league is this?",
    userMessage: "What kind of league is this?",
    allowedTools: ["get_league_info"] as const,
    executionHint:
      "Call get_league_info exactly once for Gerry's default league. Skip web search unless current season timing materially improves the framing.",
    prompt:
      "Summarize Gerry's default live league in plain English: platform, format, roster shape, and the one or two settings that most affect strategy. Keep it intuitive, not exhaustive. Final answer: 45-80 words.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "League Setup",
  },
  {
    id: "simple-standings",
    title: "Is Gerry off to a good start?",
    userMessage: "Is Gerry off to a good start?",
    allowedTools: ["get_standings"] as const,
    executionHint:
      "Call get_standings exactly once for Gerry's default league. Skip web search unless one brief current note materially sharpens the read.",
    prompt:
      "Answer whether Gerry is off to a good start in his league. Ground it in the current standings, mention where he sits, and briefly note who is setting the pace. If the season is just opening and everyone is effectively tied, say that directly instead of forcing a strong verdict. Final answer: 45-80 words.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Fast Start?",
  },
  {
    id: "simple-matchup",
    title: "Who is Gerry facing, and what matters most?",
    userMessage: "Who is Gerry facing, and what matters most?",
    allowedTools: ["get_matchups"] as const,
    executionHint:
      "Call get_matchups exactly once for Gerry's default league. Use web search only if a current injury, lineup, role, or schedule note materially affects the matchup headline.",
    prompt:
      "Say who Gerry is facing right now and identify the single biggest storyline in that matchup. Add current public context only if it materially affects the read. Final answer: 45-80 words.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "This Matchup",
  },
  {
    id: "simple-roster",
    title: "Who's carrying Gerry's team right now?",
    userMessage: "Who's carrying Gerry's team right now?",
    allowedTools: ["get_roster"] as const,
    executionHint:
      "Call get_roster exactly once for Gerry's default league. Use web search only if a current injury, lineup, or role change materially alters the roster read.",
    prompt:
      "Identify the player or small group of players currently carrying Gerry's team and explain why they set the tone for the roster right now. Add one current public-context note only if it materially changes the evaluation. Final answer: 45-80 words.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Carrying Team",
  },
  {
    id: "simple-free-agents",
    title: "What's the smartest waiver move right now?",
    userMessage: "What's the smartest waiver move right now?",
    allowedTools: ["get_free_agents"] as const,
    executionHint:
      "Call get_free_agents exactly once for Gerry's default fantasy league. Start by identifying the strongest available fit from Gerry's actual wire, then decide whether one brief public-context note on that same player would make the recommendation more convincing.",
    prompt:
      "Identify the smartest waiver move Gerry could make right now in his fantasy league. Start with the actual available free agents in Gerry's league, pick the single best add, and explain what fantasy need that player solves for a competitive team. Add one fallback only if the choice is genuinely close and clearly supported by the same wire view. If public context helps, use it to strengthen the case for the player you already chose from Gerry's wire. Final answer: 45-80 words.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Waiver Move",
  },
  {
    id: "simple-player-lookup",
    title: "Who on Gerry's team is trending the wrong way?",
    userMessage: "Who on Gerry's team is trending the wrong way?",
    allowedTools: ["get_roster", "get_players"] as const,
    executionHint:
      "Start with get_roster for Gerry's default fantasy league. Use get_players only if you need to verify one specific fantasy-relevant player detail. Use web search only if current performance, injury, or role materially changes the verdict.",
    prompt:
      "Identify the one player on Gerry's current fantasy roster whose trend looks the most worrying right now. This question is about Gerry's fantasy roster, not general MLB disappointment or the biggest name underperforming league-wide. Explain why that player is the biggest concern in plain English. Use public context only if it materially changes the takeaway. Final answer: 45-80 words.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Bad Trend",
  },
  {
    id: "simple-transactions",
    title: "Which league move actually matters?",
    userMessage: "Which league move actually matters?",
    allowedTools: ["get_transactions"] as const,
    serverPrefetch: "transactions",
    executionHint:
      "Use the prefetched transaction feed or call get_transactions exactly once. Skip web search unless it helps explain why the single most relevant move matters.",
    prompt:
      "Call out the single league move that matters most right now and explain why it matters. Prioritize actual impact over pure recency. Do not narrate your search or research process. If you use web search, fold it into the analysis naturally. End with a complete sentence. Final answer: 45-80 words.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Move That Matters",
  },
  {
    id: "simple-history",
    title: "Has Gerry ever won this thing?",
    userMessage: "Has Gerry ever won this thing?",
    allowedTools: ["get_ancient_history"] as const,
    executionHint:
      "Call get_ancient_history exactly once for Gerry's most relevant fantasy league. Treat the recorded season outcomes in that history as the evidence for Gerry's championship status. The team name is not evidence of championship history. You must call get_ancient_history to get actual recorded season outcomes. Start with Gerry's best confirmed finish, then answer whether he has won.",
    prompt:
      "Use Gerry's fantasy league history to answer whether he has actually won before, and what the clearest historical takeaway is. Base the win answer on the recorded season outcomes in Gerry's league history. Begin with the best finish you can confirm, then answer the win question directly, then give one short takeaway about what that history says about Gerry as a fantasy manager. Keep it fun, but let the confirmed finish do the work. Final answer: 45-80 words.",
    homepageSection: "simple",
    showInChat: false,
    rail: "top",
    toolLabel: "Won Before?",
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
      "Start by understanding Gerry's clearest roster need from his current team, then inspect the actual free-agent pool for that league, then choose the best fit. Use get_players only to verify one candidate detail. If public context helps, use it only on the player you already selected from Gerry's wire.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. First identify Gerry's clearest roster need. Then choose one primary waiver add from the players who are actually available in his league, with at most one fallback if it is genuinely close. Explain why the target fits Gerry's team and this league format, then add current public context only if it sharpens the call you already made. Final answer: 90-150 words.",
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
      "Use the prefetched transaction feed or call get_transactions exactly once for Gerry's default league. Use get_roster or get_players only if the feed alone is not enough to explain why a move matters. Use web search only if current news materially explains the key move.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Call out the one or two league moves that actually matter and explain why they matter for competitive balance, roster leverage, or player value. Use public context only if it materially sharpens the explanation. Final answer: 90-150 words.",
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
      "Start with get_standings for Gerry's default league and decide whether there is a real leader yet or only an early edge. Use get_roster or get_matchups only to support that read with one concrete fantasy reason. If public context helps, use it to explain the edge, not to replace the standings read.",
    prompt:
      "Use Flaim to inspect Gerry's best default live fantasy league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Start with the actual standings. If one team is clearly on top, explain why. If the league is still effectively tied, identify the team with the strongest early fantasy edge and explain what is driving that edge. Use one concrete fantasy indicator, then add public context only if it makes that same explanation more believable. Final answer: 90-150 words.",
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
      "Start with get_league_info if needed, then get_roster for Gerry's default fantasy league. Use get_players only if you need to verify one specific fantasy-relevant player detail. Use web search only if current performance, role, or injury context materially changes the verdict.",
    prompt:
      "Use Flaim to inspect Gerry's best default live fantasy league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. This question is about the weakest hold on Gerry's fantasy roster, not a general MLB disappointment list or a player you personally dislike. Identify the one player on Gerry's roster he should be most worried about keeping, explain why the fantasy hold is weak, and say what would make you change your mind. Use public context only if it materially changes the call. Final answer: 90-150 words.",
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
    allowedTools: ["get_league_info", "get_roster", "get_free_agents", "get_players"] as const,
    executionHint:
      "You must call get_league_info first to understand the league format, then call get_roster to diagnose the hole. Use get_free_agents for one practical replacement path. Use get_players only if you need to verify one candidate detail. Do not skip these tool calls. Use web search only if current injuries, roles, or trends materially sharpen the diagnosis.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Identify the single biggest hole in Gerry's roster, explain why it is the most important problem right now, and give one practical path to start fixing it. Use public context only if it materially changes the diagnosis. Final answer: 90-150 words.",
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
      "Start with Gerry's current roster and identify the player whose present fantasy value looks strongest relative to the most stable rest-of-season case. Use get_players only to verify one specific player detail. If public context helps, use it to sharpen the market-window argument for that same player.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Pick the one player on Gerry's roster whose current fantasy value looks easiest to market at a premium right now. Explain why that player has a real sell-high window in fantasy terms, what makes the window timely, and what kind of stability or risk sits behind the current value. Add current public context only if it helps explain why the market window is open right now. Final answer: 90-150 words.",
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
      "Start with get_ancient_history for Gerry's most relevant league. Only use get_standings if you need one extra check to frame the result. Skip web search unless one brief season anchor genuinely helps.",
    prompt:
      "Use Flaim to inspect Gerry's best default live league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. Review Gerry's result from last season in the most relevant league and summarize how he did plus the clearest takeaway from that season. Skip web search unless one brief season anchor genuinely helps. Final answer: 80-130 words.",
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
      "Start with get_league_info for Gerry's default fantasy league to anchor the league settings. Only use get_matchups if league info alone does not clarify the fantasy playoff timing. Skip web search unless current fantasy schedule timing materially affects the planning angle.",
    prompt:
      "Use Flaim to inspect Gerry's best default live fantasy league from the injected context. If that context is missing or unclear, prefer Gerry's baseball league for this demo. This question is about Gerry's fantasy league playoff settings, not the MLB playoff race or postseason calendar. Figure out when Gerry's fantasy playoffs start in his current fantasy league and explain what that timing means for his roster planning right now. Focus on the fantasy playoff date and one or two specific planning implications. Avoid generic schedule filler or broad season-long advice. Final answer: 80-120 words.",
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
