import { PUBLIC_CHAT_MODEL } from "@/lib/public-chat";
import OpenAI from "openai";
import { getOrRefreshPublicChatCache } from "./public-chat-cache";

function getPublicChatWebSearchTool() {
  return {
    type: "web_search_preview" as const,
    user_location: {
      type: "approximate" as const,
      country: "US",
      region: "New York",
      city: "Rochester",
    },
  };
}

function getTodayInEastern() {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeZone: "America/New_York",
  }).format(new Date());
}

async function buildSportsTodayPulse(): Promise<string | null> {
  const todayInEastern = getTodayInEastern();
  const openai = new OpenAI();
  const response = await openai.responses.create({
    model: PUBLIC_CHAT_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You prepare a short cached sports pulse for Flaim's public demo. Use web search. Return one short paragraph in plain English. No links. No source citations. No bullet list. Keep it under 90 words.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Today in Rochester, New York is ${todayInEastern}. Summarize the most relevant fantasy-sports context happening today across major sports in a way that can help flavor Gerry's fantasy answers. Focus on big injuries, role changes, breakout performances, schedule context, and league-wide storylines that matter right now.`,
          },
        ],
      },
    ],
    tools: [getPublicChatWebSearchTool()],
    store: false,
    parallel_tool_calls: false,
    tool_choice: "auto",
  });

  const text = response.output_text?.trim();
  if (!text) {
    return null;
  }

  return [
    `Cached sports pulse for ${todayInEastern}.`,
    "Use this as current sports-world context for the public demo unless a live search in the turn gives you something more specific.",
    text,
  ].join("\n");
}

export async function getCachedSportsTodayPulse(): Promise<string | null> {
  return getOrRefreshPublicChatCache({
    cacheKey: "sports_today_v1",
    ttlMs: 60 * 60 * 1000,
    label: "sports today pulse",
    build: buildSportsTodayPulse,
  });
}
