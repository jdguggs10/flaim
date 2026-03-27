import { isAllowedUrl } from "@/lib/mcp-url-allowlist";
import { getOrRefreshPublicChatCache } from "./public-chat-cache";

export interface PublicChatLeague {
  platform?: string | null;
  sport?: string | null;
  leagueId?: string | null;
  teamId?: string | null;
  seasonYear?: number | null;
  leagueName?: string | null;
  teamName?: string | null;
}

export interface PublicChatSessionData {
  success?: boolean;
  defaultSport?: string | null;
  totalLeaguesFound?: number;
  defaultLeague?: PublicChatLeague | null;
  defaultLeagues?: Record<string, PublicChatLeague>;
  allLeagues?: PublicChatLeague[];
  warnings?: string[];
}

interface DemoMcpToolResponse<T> {
  result?: {
    structuredContent?: T;
    content?: Array<{ type?: string; text?: string }>;
  };
}

interface PublicChatLeagueInfoData {
  success?: boolean;
  data?: {
    teams?: Array<{
      teamId?: string | number | null;
      teamName?: string | null;
    }>;
  };
}

function normalizeMcpUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/mcp") ? trimmed : `${trimmed}/mcp`;
}

function getDemoMcpConfig() {
  const serverUrl = normalizeMcpUrl(
    process.env.FANTASY_MCP_URL || "https://api.flaim.app/mcp"
  );

  if (!isAllowedUrl(serverUrl)) {
    throw new Error("Configured MCP server URL is not allowed");
  }

  const demoApiKey = process.env.DEMO_API_KEY?.trim();
  if (!demoApiKey) {
    throw new Error("DEMO_API_KEY is not configured");
  }

  return { serverUrl, demoApiKey };
}

function extractStructuredContent<T>(payload: unknown): T | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const result =
    "result" in payload && payload.result && typeof payload.result === "object"
      ? (payload.result as Record<string, unknown>)
      : null;

  const structuredContent =
    result && "structuredContent" in result
      ? result.structuredContent
      : null;

  if (!structuredContent || typeof structuredContent !== "object") {
    return null;
  }

  return structuredContent as T;
}

function extractJsonFromSse(text: string): unknown {
  const data = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
    .trim();

  if (!data) {
    return null;
  }

  return JSON.parse(data);
}

async function fetchPublicChatSessionData(): Promise<PublicChatSessionData | null> {
  return callDemoMcpTool<PublicChatSessionData>("get_user_session", {}, "public-chat-session");
}

function extractJsonFromContent<T>(payload: unknown): T | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const result =
    "result" in payload && payload.result && typeof payload.result === "object"
      ? (payload.result as DemoMcpToolResponse<T>["result"])
      : null;

  const text = result?.content
    ?.filter((entry) => entry?.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n")
    .trim();

  if (!text) {
    return null;
  }

  return JSON.parse(text) as T;
}

async function callDemoMcpTool<T>(
  toolName: string,
  args: Record<string, unknown>,
  requestId: string
): Promise<T | null> {
  const { serverUrl, demoApiKey } = getDemoMcpConfig();
  const response = await fetch(serverUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${demoApiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch public chat session (${response.status})`);
  }

  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();

  const payload = contentType.includes("text/event-stream")
    ? extractJsonFromSse(rawText)
    : JSON.parse(rawText);

  return extractStructuredContent<T>(payload) ?? extractJsonFromContent<T>(payload);
}

function buildLeagueRefreshKey(league: PublicChatLeague) {
  const platform = league.platform || "unknown";
  const sport = league.sport || "unknown";
  const leagueId = league.leagueId || "unknown";
  const seasonYear = league.seasonYear || "unknown";

  return `${platform}:${sport}:${leagueId}:${seasonYear}`;
}

async function fetchEspnLeagueTeamNames(
  league: PublicChatLeague
): Promise<Map<string, string> | null> {
  if (
    league.platform !== "espn" ||
    !league.sport ||
    !league.leagueId ||
    typeof league.seasonYear !== "number"
  ) {
    return null;
  }

  const payload = await callDemoMcpTool<PublicChatLeagueInfoData>(
    "get_league_info",
    {
      platform: "espn",
      sport: league.sport,
      league_id: league.leagueId,
      season_year: league.seasonYear,
    },
    `public-chat-league-${league.leagueId}-${league.seasonYear}`
  ).catch((error) => {
    console.error("Failed to refresh public chat ESPN league info:", error);
    return null;
  });

  const teams = payload?.data?.teams;
  if (!Array.isArray(teams) || teams.length === 0) {
    return null;
  }

  return new Map(
    teams
      .filter(
        (team) =>
          team?.teamId != null &&
          typeof team.teamName === "string" &&
          team.teamName.trim().length > 0
      )
      .map((team) => [String(team.teamId), team.teamName!.trim()])
  );
}

function applyRefreshedTeamName(
  league: PublicChatLeague | null | undefined,
  refreshedNames: Map<string, string>
): PublicChatLeague | null | undefined {
  if (!league || !league.teamId) {
    return league;
  }

  const refreshedName = refreshedNames.get(String(league.teamId));
  if (!refreshedName || refreshedName === league.teamName) {
    return league;
  }

  return {
    ...league,
    teamName: refreshedName,
  };
}

async function refreshSessionTeamNames(
  sessionData: PublicChatSessionData
): Promise<PublicChatSessionData> {
  const candidateLeagues = [
    sessionData.defaultLeague ?? null,
    ...Object.values(sessionData.defaultLeagues ?? {}),
    ...(Array.isArray(sessionData.allLeagues) ? sessionData.allLeagues : []),
  ].filter(
    (league): league is PublicChatLeague =>
      Boolean(
        league &&
          league.platform === "espn" &&
          league.sport &&
          league.leagueId &&
          typeof league.seasonYear === "number"
      )
  );

  if (candidateLeagues.length === 0) {
    return sessionData;
  }

  const uniqueLeagues = Array.from(
    new Map(
      candidateLeagues.map((league) => [buildLeagueRefreshKey(league), league])
    ).values()
  );

  const refreshedLeagueNames = new Map<string, Map<string, string>>();
  const refreshResults = await Promise.all(
    uniqueLeagues.map(async (league) => {
      const teams = await fetchEspnLeagueTeamNames(league);
      return {
        key: buildLeagueRefreshKey(league),
        teams,
      };
    })
  );

  for (const result of refreshResults) {
    if (result.teams && result.teams.size > 0) {
      refreshedLeagueNames.set(result.key, result.teams);
    }
  }

  if (refreshedLeagueNames.size === 0) {
    return sessionData;
  }

  const refreshLeague = (league: PublicChatLeague | null | undefined) => {
    if (!league) {
      return league;
    }

    const refreshedNames = refreshedLeagueNames.get(buildLeagueRefreshKey(league));
    return refreshedNames ? applyRefreshedTeamName(league, refreshedNames) : league;
  };

  return {
    ...sessionData,
    defaultLeague: refreshLeague(sessionData.defaultLeague) ?? null,
    defaultLeagues: Object.fromEntries(
      Object.entries(sessionData.defaultLeagues ?? {}).map(([sport, league]) => [
        sport,
        refreshLeague(league) ?? league,
      ])
    ),
    allLeagues: (sessionData.allLeagues ?? []).map((league) => refreshLeague(league) ?? league),
  };
}

export async function getCachedPublicChatSessionData(): Promise<PublicChatSessionData | null> {
  const rawValue = await getOrRefreshPublicChatCache({
    cacheKey: "gerry_session_data_v2",
    ttlMs: 10 * 60 * 1000,
    label: "public chat session data",
    build: async () => {
      const sessionData = await fetchPublicChatSessionData().catch((error) => {
        console.error("Failed to fetch public chat session data:", error);
        return null;
      });

      if (!sessionData || sessionData.success === false) {
        return null;
      }

      const refreshedSessionData = await refreshSessionTeamNames(sessionData).catch(
        (error) => {
          console.error("Failed to refresh public chat session team names:", error);
          return sessionData;
        }
      );

      return JSON.stringify(refreshedSessionData);
    },
  });

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as PublicChatSessionData;
  } catch (error) {
    console.error("Failed to parse cached public chat session data:", error);
    return null;
  }
}

function formatLeagueLabel(league: PublicChatLeague) {
  const sport = league.sport || "unknown sport";
  const leagueName = league.leagueName || "Unnamed league";
  const teamName = league.teamName || "Unknown team";
  const seasonYear = league.seasonYear || "current";
  const platform = league.platform || "unknown platform";

  return `${sport} on ${platform} in ${seasonYear}: "${leagueName}" with Gerry on "${teamName}"`;
}

export async function buildPublicChatContext(): Promise<string | null> {
  const sessionData = await getCachedPublicChatSessionData();

  if (!sessionData || sessionData.success === false) {
    return null;
  }

  const defaultLeague = sessionData.defaultLeague
    ? formatLeagueLabel(sessionData.defaultLeague)
    : null;
  const defaultSport = sessionData.defaultSport || "none";
  const leagues = Array.isArray(sessionData.allLeagues) ? sessionData.allLeagues : [];
  const leagueSummary = leagues.slice(0, 6).map((league) => {
    const sport = league.sport || "unknown";
    const platform = league.platform || "unknown";
    const leagueName = league.leagueName || "Unnamed league";
    const teamName = league.teamName || "Unknown team";
    const seasonYear = league.seasonYear || "current";
    const leagueId = league.leagueId || "missing";
    const teamId = league.teamId || "missing";

    return `- ${sport} on ${platform}: "${leagueName}" (${seasonYear}), Gerry's team "${teamName}", leagueId="${leagueId}", teamId="${teamId}"`;
  });

  const perSportDefaults = sessionData.defaultLeagues
    ? Object.entries(sessionData.defaultLeagues).map(([sport, league]) => {
        const leagueId = league.leagueId || "missing";
        const teamId = league.teamId || "missing";
        return `- ${sport}: "${league.leagueName || "Unnamed league"}" on ${league.platform || "unknown"} with Gerry's team "${league.teamName || "Unknown team"}" (leagueId="${leagueId}", teamId="${teamId}", seasonYear=${league.seasonYear || "current"})`;
      })
    : [];

  const warnings =
    sessionData.warnings && sessionData.warnings.length > 0
      ? `Warnings from session preload: ${sessionData.warnings.join(" | ")}`
      : null;

  return [
    "Public demo session context for Gerry. This was prefetched on the server before your turn.",
    "Treat it as the current starting context and do not call get_user_session unless this context is clearly insufficient.",
    `Default sport: ${defaultSport}`,
    defaultLeague ? `Best default league right now: ${defaultLeague}` : null,
    perSportDefaults.length > 0 ? "Default league by sport:" : null,
    perSportDefaults.length > 0 ? perSportDefaults.join("\n") : null,
    leagueSummary.length > 0 ? "Current connected leagues:" : null,
    leagueSummary.length > 0 ? leagueSummary.join("\n") : null,
    warnings,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function getCachedPublicChatContext(): Promise<string | null> {
  return getOrRefreshPublicChatCache({
    cacheKey: "gerry_session_v2",
    ttlMs: 10 * 60 * 1000,
    label: "public chat session context",
    build: buildPublicChatContext,
  });
}
