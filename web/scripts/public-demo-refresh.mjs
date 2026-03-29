import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  PUBLIC_CHAT_SYSTEM_PROMPT,
  PUBLIC_DEMO_CONTEXT_VERSION,
  PUBLIC_DEMO_PROMPT_VERSION,
  getPublicChatPreset,
} from "../lib/public-chat.ts";
import {
  formatPublicChatAnswerForPreset,
  getPublicChatAnswerWordCount,
} from "../lib/public-chat-output.ts";
import { isAllowedUrl } from "../lib/mcp-url-allowlist.ts";

const execFileAsync = promisify(execFile);

const DEFAULT_GEMINI_BIN = "gemini";
const DEFAULT_EXPIRES_MINUTES = 60;
const DEFAULT_STALE_MINUTES = 180;
const DEFAULT_CONTEXT_TTL_MINUTES = 10;
const DEFAULT_PROVIDER = "gemini";
const DEFAULT_PREFETCH_TRANSACTION_COUNT = 25;
const DEFAULT_PROVIDER_TIMEOUT_MS = 120000;

function printUsage() {
  console.log(`Usage:
  npm run public-demo:refresh -- --preset <presetId> --sport <baseball|football> [options]

Options:
  --preset <id>               Public demo preset ID (required)
  --sport <sport>            Demo sport: baseball or football (required)
  --provider <name>          Provider to use (default: gemini)
  --model <name>             Optional provider model override
  --expires-minutes <n>      Cache expiry boundary in minutes (default: 60)
  --stale-minutes <n>        Stale boundary in minutes (default: 180)
  --gemini-bin <path>        Gemini CLI binary path (default: gemini)
  --dry-run                  Build prompt and run provider, but do not write cache rows
  --print-prompt             Print the full assembled prompt before running
  --verbose                  Print extra runtime details
  --help                     Show this help
`);
}

function parseArgs(argv) {
  const options = {
    provider: DEFAULT_PROVIDER,
    expiresMinutes: DEFAULT_EXPIRES_MINUTES,
    staleMinutes: DEFAULT_STALE_MINUTES,
    geminiBin: process.env.PUBLIC_DEMO_GEMINI_BIN?.trim() || DEFAULT_GEMINI_BIN,
    dryRun: false,
    printPrompt: false,
    verbose: false,
    model: process.env.PUBLIC_DEMO_GEMINI_MODEL?.trim() || "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--print-prompt") {
      options.printPrompt = true;
      continue;
    }

    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    index += 1;

    switch (key) {
      case "preset":
        options.presetId = value;
        break;
      case "sport":
        options.sport = value;
        break;
      case "provider":
        options.provider = value;
        break;
      case "model":
        options.model = value;
        break;
      case "expires-minutes":
        options.expiresMinutes = parsePositiveInteger(value, "--expires-minutes");
        break;
      case "stale-minutes":
        options.staleMinutes = parsePositiveInteger(value, "--stale-minutes");
        break;
      case "gemini-bin":
        options.geminiBin = value;
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  return options;
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return parsed;
}

function isPublicChatDemoSport(value) {
  return value === "baseball" || value === "football";
}

function loadEnvFiles(projectRoot) {
  const envFiles = [
    path.join(projectRoot, ".env.local"),
    path.join(projectRoot, ".env"),
  ];

  for (const filePath of envFiles) {
    try {
      process.loadEnvFile(filePath);
    } catch {
      // Ignore missing env files so CI or remote runners can use process env directly.
    }
  }
}

function normalizeMcpUrl(url) {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/mcp") ? trimmed : `${trimmed}/mcp`;
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY?.trim();

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_KEY is not configured");
  }

  return { supabaseUrl, supabaseServiceKey };
}

function getDemoMcpConfig() {
  const serverUrl = normalizeMcpUrl(
    process.env.FANTASY_MCP_URL || "https://api.flaim.app/mcp",
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

async function supabaseSelect(tableName, searchParams) {
  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();
  const url = new URL(`${supabaseUrl}/rest/v1/${tableName}`);

  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to read ${tableName} (${response.status})`);
  }

  return response.json();
}

async function supabaseUpsert(tableName, row) {
  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${tableName}`, {
    method: "POST",
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([row]),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to write ${tableName} (${response.status}): ${body}`);
  }
}

async function insertRefreshRun(row) {
  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/public_demo_refresh_runs`, {
    method: "POST",
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify([row]),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to write public_demo_refresh_runs (${response.status}): ${body}`,
    );
  }
}

class PublicDemoRefreshError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function sanitizeFailureMessage(error, fallbackMessage) {
  const rawMessage = error instanceof Error ? error.message : String(error);

  if (rawMessage.startsWith("Command failed:")) {
    return fallbackMessage;
  }

  if (rawMessage.length > 400) {
    return `${rawMessage.slice(0, 397)}...`;
  }

  return rawMessage;
}

async function getCachedTextEntry(cacheKey) {
  const rows = await supabaseSelect("public_chat_context_cache", {
    cache_key: `eq.${cacheKey}`,
    select: "cache_key,context_text,expires_at,updated_at",
    limit: "1",
  });

  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getExistingPublicDemoAnswerRow(presetId, sport) {
  const rows = await supabaseSelect("public_demo_answer_cache", {
    cache_key: `eq.${buildPublicDemoAnswerCacheKey(presetId, sport)}`,
    select: [
      "cache_key",
      "preset_id",
      "sport",
      "provider",
      "provider_model",
      "context_version",
      "prompt_version",
      "answer_text",
      "answer_word_count",
      "generated_at",
      "expires_at",
      "stale_after",
      "status",
      "generation_ms",
      "source_meta",
      "tool_trace_summary",
      "updated_at",
    ].join(","),
    limit: "1",
  });

  return Array.isArray(rows) ? rows[0] || null : null;
}

async function writeCachedTextEntry(cacheKey, contextText, ttlMinutes) {
  await supabaseUpsert("public_chat_context_cache", {
    cache_key: cacheKey,
    context_text: contextText,
    expires_at: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
}

function isFresh(entry) {
  if (!entry?.expires_at) {
    return false;
  }

  const expiresAt = new Date(entry.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function extractStructuredContent(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const result = payload.result && typeof payload.result === "object"
    ? payload.result
    : null;

  const structuredContent =
    result && "structuredContent" in result ? result.structuredContent : null;

  if (structuredContent && typeof structuredContent === "object") {
    return structuredContent;
  }

  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n")
    .trim();

  if (!text) {
    return null;
  }

  return JSON.parse(text);
}

function extractJsonFromSse(text) {
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

async function callDemoMcpTool(toolName, args, requestId) {
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
    throw new Error(`Failed to call ${toolName} (${response.status})`);
  }

  const rawText = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("text/event-stream")
    ? extractJsonFromSse(rawText)
    : JSON.parse(rawText);

  return extractStructuredContent(payload);
}

async function fetchPublicChatSessionData() {
  return callDemoMcpTool(
    "get_user_session",
    {},
    `public-demo-refresh-session-${crypto.randomUUID()}`,
  );
}

function buildLeagueRefreshKey(league) {
  const platform = league.platform || "unknown";
  const sport = league.sport || "unknown";
  const leagueId = league.leagueId || "unknown";
  const seasonYear = league.seasonYear || "unknown";

  return `${platform}:${sport}:${leagueId}:${seasonYear}`;
}

async function fetchEspnLeagueTeamNames(league) {
  if (
    league.platform !== "espn" ||
    !league.sport ||
    !league.leagueId ||
    typeof league.seasonYear !== "number"
  ) {
    return null;
  }

  const payload = await callDemoMcpTool(
    "get_league_info",
    {
      platform: "espn",
      sport: league.sport,
      league_id: league.leagueId,
      season_year: league.seasonYear,
    },
    `public-demo-refresh-league-${league.leagueId}-${league.seasonYear}`,
  ).catch(() => null);

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
          team.teamName.trim().length > 0,
      )
      .map((team) => [String(team.teamId), team.teamName.trim()]),
  );
}

function applyRefreshedTeamName(league, refreshedNames) {
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

async function refreshSessionTeamNames(sessionData) {
  const candidateLeagues = [
    sessionData.defaultLeague ?? null,
    ...Object.values(sessionData.defaultLeagues ?? {}),
    ...(Array.isArray(sessionData.allLeagues) ? sessionData.allLeagues : []),
  ].filter(
    (league) =>
      Boolean(
        league &&
          league.platform === "espn" &&
          league.sport &&
          league.leagueId &&
          typeof league.seasonYear === "number",
      ),
  );

  if (candidateLeagues.length === 0) {
    return sessionData;
  }

  const uniqueLeagues = Array.from(
    new Map(
      candidateLeagues.map((league) => [buildLeagueRefreshKey(league), league]),
    ).values(),
  );

  const refreshedLeagueNames = new Map();
  const refreshResults = await Promise.all(
    uniqueLeagues.map(async (league) => {
      const teams = await fetchEspnLeagueTeamNames(league);
      return {
        key: buildLeagueRefreshKey(league),
        teams,
      };
    }),
  );

  for (const result of refreshResults) {
    if (result.teams && result.teams.size > 0) {
      refreshedLeagueNames.set(result.key, result.teams);
    }
  }

  if (refreshedLeagueNames.size === 0) {
    return sessionData;
  }

  const refreshLeague = (league) => {
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
      ]),
    ),
    allLeagues: (sessionData.allLeagues ?? []).map(
      (league) => refreshLeague(league) ?? league,
    ),
  };
}

async function getOrRefreshCachedText(cacheKey, ttlMinutes, build) {
  const existing = await getCachedTextEntry(cacheKey).catch(() => null);
  if (isFresh(existing)) {
    return existing.context_text;
  }

  const nextValue = await build();
  if (!nextValue) {
    return existing?.context_text ?? null;
  }

  await writeCachedTextEntry(cacheKey, nextValue, ttlMinutes).catch(() => {});
  return nextValue;
}

async function getCachedPublicChatSessionData() {
  const rawValue = await getOrRefreshCachedText(
    "gerry_session_data_v2",
    DEFAULT_CONTEXT_TTL_MINUTES,
    async () => {
      const sessionData = await fetchPublicChatSessionData().catch(() => null);
      if (!sessionData || sessionData.success === false) {
        return null;
      }

      const refreshedSessionData = await refreshSessionTeamNames(sessionData).catch(
        () => sessionData,
      );

      return JSON.stringify(refreshedSessionData);
    },
  );

  if (!rawValue) {
    return null;
  }

  return JSON.parse(rawValue);
}

function formatLeagueLabel(league) {
  const sport = league.sport || "unknown sport";
  const leagueName = league.leagueName || "Unnamed league";
  const teamName = league.teamName || "Unknown team";
  const seasonYear = league.seasonYear || "current";
  const platform = league.platform || "unknown platform";

  return `${sport} on ${platform} in ${seasonYear}: "${leagueName}" with Gerry on "${teamName}"`;
}

async function getCachedPublicChatContext() {
  return getOrRefreshCachedText(
    "gerry_session_v2",
    DEFAULT_CONTEXT_TTL_MINUTES,
    async () => {
      const sessionData = await getCachedPublicChatSessionData();

      if (!sessionData || sessionData.success === false) {
        return null;
      }

      const defaultLeague = sessionData.defaultLeague
        ? formatLeagueLabel(sessionData.defaultLeague)
        : null;
      const defaultSport = sessionData.defaultSport || "none";
      const leagues = Array.isArray(sessionData.allLeagues)
        ? sessionData.allLeagues
        : [];
      const leagueSummary = leagues.slice(0, 6).map((league) => {
        const sport = league.sport || "unknown";
        const platform = league.platform || "unknown";
        const leagueName = league.leagueName || "Unnamed league";
        const teamName = league.teamName || "Unknown team";
        const seasonYear = league.seasonYear || "current";
        const leagueId = league.leagueId || "missing";
        const teamId = league.teamId || "missing";

        return `- ${sport} on ${platform}: "${leagueName}" (${seasonYear}), Gerry's team "${teamName}" [internal ids for tool use only: leagueId="${leagueId}", teamId="${teamId}"]`;
      });

      const perSportDefaults = sessionData.defaultLeagues
        ? Object.entries(sessionData.defaultLeagues).map(([sport, league]) => {
            const leagueId = league.leagueId || "missing";
            const teamId = league.teamId || "missing";
            return `- ${sport}: "${league.leagueName || "Unnamed league"}" on ${league.platform || "unknown"} with Gerry's team "${league.teamName || "Unknown team"}" (seasonYear=${league.seasonYear || "current"}, internal ids for tool use only: leagueId="${leagueId}", teamId="${teamId}")`;
          })
        : [];

      const warnings =
        sessionData.warnings && sessionData.warnings.length > 0
          ? `Warnings from session preload: ${sessionData.warnings.join(" | ")}`
          : null;

      return [
        "Public demo session context for Gerry. This was prefetched on the server before your turn.",
        "Treat it as the current starting context and do not call get_user_session unless this context is clearly insufficient.",
        "Any internal identifiers in this context are for tool use only. Never repeat leagueId or teamId in the final answer.",
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
    },
  );
}

function resolveLeagueForSport(selectedSport, defaultLeague, defaultLeagues) {
  const sportLeague = defaultLeagues?.[selectedSport];
  if (sportLeague) {
    return sportLeague;
  }

  if (defaultLeague?.sport === selectedSport) {
    return defaultLeague;
  }

  return defaultLeague ?? null;
}

async function prefetchTransactions(selectedSport) {
  const sessionData = await getCachedPublicChatSessionData();
  const league = resolveLeagueForSport(
    selectedSport,
    sessionData?.defaultLeague,
    sessionData?.defaultLeagues,
  );

  if (
    !league?.platform ||
    !league.sport ||
    !league.leagueId ||
    typeof league.seasonYear !== "number"
  ) {
    return null;
  }

  const result = await callDemoMcpTool(
    "get_transactions",
    {
      platform: league.platform,
      sport: league.sport,
      league_id: league.leagueId,
      season_year: league.seasonYear,
      count: DEFAULT_PREFETCH_TRANSACTION_COUNT,
    },
    `public-demo-refresh-prefetch-${crypto.randomUUID()}`,
  ).catch(() => null);

  if (!result?.success || !result.data) {
    return null;
  }

  return {
    league,
    result: result.data,
  };
}

function buildPrompt({ preset, sport, publicChatContext, prefetchedTransactions }) {
  const todayInEastern = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeZone: "America/New_York",
  }).format(new Date());

  const sections = [
    "You are generating a cacheable answer for Flaim's public homepage demo.",
    "Use the instructions below as the full task definition.",
    "",
    "SYSTEM INSTRUCTIONS",
    PUBLIC_CHAT_SYSTEM_PROMPT,
    "",
    "RUNTIME RULES",
    "- Use Gerry's league data first through the fantasy MCP server.",
    "- Use web search once after league data to add one current sports detail.",
    "- Do not use shell tools, file tools, or any local workspace content.",
    "- Return final answer text only. No markdown bullets, citations, links, or source names.",
    "",
    publicChatContext ? "SERVER CONTEXT" : null,
    publicChatContext || null,
    "",
    "RUN-SPECIFIC CONTEXT",
    `Today in Gerry's timezone is ${todayInEastern}.`,
    `Selected demo sport for this run: ${sport}. Treat this as authoritative.`,
    `Execution hint for speed: ${preset.executionHint}`,
    prefetchedTransactions
      ? [
          "Server-prefetched transaction feed for this run. Treat it as authoritative and do not call get_transactions again.",
          `League context: platform=${prefetchedTransactions.league.platform}, sport=${prefetchedTransactions.league.sport}, seasonYear=${prefetchedTransactions.league.seasonYear}, Gerry's team="${prefetchedTransactions.league.teamName || "Unknown team"}".`,
          `Transaction feed JSON: ${JSON.stringify(prefetchedTransactions.result)}`,
        ].join("\n")
      : null,
    "",
    "USER REQUEST",
    preset.prompt,
  ];

  return sections.filter(Boolean).join("\n");
}

function getToolTraceNames(toolTraceSummary) {
  if (!toolTraceSummary || typeof toolTraceSummary !== "object") {
    return [];
  }

  const byName =
    "byName" in toolTraceSummary &&
    toolTraceSummary.byName &&
    typeof toolTraceSummary.byName === "object"
      ? toolTraceSummary.byName
      : null;

  return byName ? Object.keys(byName) : [];
}

function hasFantasyMcpToolCall(toolTraceSummary) {
  return getToolTraceNames(toolTraceSummary).some((name) =>
    name.startsWith("mcp_fantasy_"),
  );
}

function requiresMcpGrounding(preset, prefetchedTransactions) {
  return preset.allowedTools.length > 0 || Boolean(prefetchedTransactions);
}

function validateProviderResult({
  preset,
  prefetchedTransactions,
  formattedAnswer,
  providerResult,
}) {
  if (!formattedAnswer) {
    throw new PublicDemoRefreshError(
      "empty_answer",
      "Provider returned an empty answer after formatting",
    );
  }

  const usedFantasyMcp = hasFantasyMcpToolCall(providerResult.toolTraceSummary);
  if (
    requiresMcpGrounding(preset, prefetchedTransactions) &&
    !usedFantasyMcp &&
    !prefetchedTransactions
  ) {
    throw new PublicDemoRefreshError(
      "missing_mcp_grounding",
      "Latest refresh did not use Flaim league data, so the answer was rejected.",
    );
  }

  return {
    usedFantasyMcp,
  };
}

async function createGeminiProjectSettings(tempDir, headers) {
  const geminiDir = path.join(tempDir, ".gemini");
  await fs.mkdir(geminiDir, { recursive: true });
  await fs.writeFile(
    path.join(geminiDir, "settings.json"),
    JSON.stringify(
      {
        mcpServers: {
          fantasy: {
            url: getDemoMcpConfig().serverUrl,
            type: "http",
            headers,
          },
        },
      },
      null,
      2,
    ),
  );
}

async function runGeminiProvider({ prompt, geminiBin, model }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "public-demo-gemini-"));
  const { demoApiKey } = getDemoMcpConfig();

  try {
    await createGeminiProjectSettings(tempDir, {
      Authorization: `Bearer ${demoApiKey}`,
    });

    const args = [
      "-e",
      "",
      "-p",
      prompt,
      "-o",
      "json",
      "--approval-mode",
      "yolo",
      "--sandbox",
      "--allowed-mcp-server-names",
      "fantasy",
    ];

    if (model) {
      args.push("-m", model);
    }

    const startedAt = Date.now();
    const { stdout, stderr } = await execFileAsync(geminiBin, args, {
      cwd: tempDir,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
      timeout: DEFAULT_PROVIDER_TIMEOUT_MS,
    });
    const durationMs = Date.now() - startedAt;

    if (!stdout.trim()) {
      throw new Error(
        `Gemini CLI returned no JSON output${stderr ? `: ${stderr.trim()}` : ""}`,
      );
    }

    const payload = JSON.parse(stdout);
    const statsModels = payload?.stats?.models ?? {};
    const actualModel = Object.keys(statsModels)[0] || model || "gemini";

    return {
      answerText: payload?.response || "",
      durationMs,
      provider: "gemini",
      providerModel: actualModel,
      sourceMeta: {
        sessionId: payload?.session_id ?? null,
        configuredModel: model || null,
        stats: payload?.stats ?? null,
        stderr: stderr.trim() || null,
      },
      toolTraceSummary: payload?.stats?.tools ?? null,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function buildPublicDemoAnswerCacheKey(presetId, sport) {
  return [
    "public-demo-answer",
    presetId,
    sport,
    PUBLIC_DEMO_PROMPT_VERSION,
    PUBLIC_DEMO_CONTEXT_VERSION,
  ].join(":");
}

async function writePublicDemoAnswerCache({
  presetId,
  sport,
  answerText,
  answerWordCount,
  provider,
  providerModel,
  generationMs,
  sourceMeta,
  toolTraceSummary,
  expiresMinutes,
  staleMinutes,
}) {
  const now = Date.now();

  await supabaseUpsert("public_demo_answer_cache", {
    cache_key: buildPublicDemoAnswerCacheKey(presetId, sport),
    preset_id: presetId,
    sport,
    provider,
    provider_model: providerModel,
    context_version: PUBLIC_DEMO_CONTEXT_VERSION,
    prompt_version: PUBLIC_DEMO_PROMPT_VERSION,
    answer_text: answerText,
    answer_word_count: answerWordCount,
    generated_at: new Date(now).toISOString(),
    expires_at: new Date(now + expiresMinutes * 60 * 1000).toISOString(),
    stale_after: new Date(now + staleMinutes * 60 * 1000).toISOString(),
    status: "ready",
    generation_ms: generationMs,
    source_meta: sourceMeta,
    tool_trace_summary: toolTraceSummary,
    updated_at: new Date().toISOString(),
  });
}

async function markPublicDemoAnswerRefreshFailure({
  presetId,
  sport,
  provider,
  providerModel,
  failureCode,
  failureMessage,
  startedAt,
  completedAt,
}) {
  const existingRow = await getExistingPublicDemoAnswerRow(presetId, sport).catch(
    () => null,
  );

  if (!existingRow) {
    return;
  }

  const existingSourceMeta =
    existingRow.source_meta && typeof existingRow.source_meta === "object"
      ? existingRow.source_meta
      : {};

  await supabaseUpsert("public_demo_answer_cache", {
    ...existingRow,
    status: "degraded",
    source_meta: {
      ...existingSourceMeta,
      lastFailure: {
        status: "failed",
        errorCode: failureCode,
        errorMessage: failureMessage,
        providerAttempted: provider,
        providerModel,
        startedAt,
        completedAt,
      },
      lastAttemptedAt: completedAt,
      lastRefreshStatus: "failed",
    },
    updated_at: completedAt,
  });
}

function summarizeResult(result) {
  return {
    provider: result.provider,
    providerModel: result.providerModel,
    generationMs: result.durationMs,
    answerWordCount: result.answerWordCount,
    answerText: result.answerText,
  };
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "..");
  loadEnvFiles(projectRoot);

  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!options.presetId) {
    throw new Error("--preset is required");
  }

  if (!isPublicChatDemoSport(options.sport)) {
    throw new Error("--sport must be baseball or football");
  }

  if (options.provider !== "gemini") {
    throw new Error(`Unsupported provider for Phase 2: ${options.provider}`);
  }

  if (options.staleMinutes < options.expiresMinutes) {
    throw new Error("--stale-minutes must be greater than or equal to --expires-minutes");
  }

  const preset = getPublicChatPreset(options.presetId);
  if (!preset) {
    throw new Error(`Unknown public chat preset: ${options.presetId}`);
  }

  const refreshStartedAt = Date.now();
  const publicChatContext = await getCachedPublicChatContext();
  const prefetchedTransactions =
    preset.serverPrefetch === "transactions"
      ? await prefetchTransactions(options.sport)
      : null;
  const prompt = buildPrompt({
    preset,
    sport: options.sport,
    publicChatContext,
    prefetchedTransactions,
  });

  if (options.printPrompt) {
    console.log(prompt);
  }

  if (options.verbose) {
    console.error(
      JSON.stringify(
        {
          presetId: preset.id,
          sport: options.sport,
          provider: options.provider,
          configuredModel: options.model || null,
          prefetchedTransactions: Boolean(prefetchedTransactions),
          contextLoaded: Boolean(publicChatContext),
        },
        null,
        2,
      ),
    );
  }

  const providerResult = await runGeminiProvider({
    prompt,
    geminiBin: options.geminiBin,
    model: options.model || null,
  });
  const formattedAnswer = formatPublicChatAnswerForPreset(
    providerResult.answerText,
    preset.id,
  );
  const validationResult = validateProviderResult({
    preset,
    prefetchedTransactions,
    formattedAnswer,
    providerResult,
  });

  const answerWordCount = getPublicChatAnswerWordCount(formattedAnswer);
  const completedAt = new Date().toISOString();

  const finalResult = {
    ...providerResult,
    answerText: formattedAnswer,
    answerWordCount,
  };

  if (!options.dryRun) {
    await writePublicDemoAnswerCache({
      presetId: preset.id,
      sport: options.sport,
      answerText: finalResult.answerText,
      answerWordCount: finalResult.answerWordCount,
      provider: finalResult.provider,
      providerModel: finalResult.providerModel,
      generationMs: finalResult.durationMs,
      sourceMeta: finalResult.sourceMeta,
      toolTraceSummary: finalResult.toolTraceSummary,
      expiresMinutes: options.expiresMinutes,
      staleMinutes: options.staleMinutes,
    });
  }

  const refreshRun = {
    job_type: "answer",
    preset_id: preset.id,
    sport: options.sport,
    provider_attempted: finalResult.provider,
    provider_model: finalResult.providerModel,
    status: options.dryRun ? "dry_run" : "completed",
    error_code: null,
    error_message: null,
    started_at: new Date(refreshStartedAt).toISOString(),
    completed_at: completedAt,
    duration_ms: Date.now() - refreshStartedAt,
    source_meta: {
      dryRun: options.dryRun,
      promptVersion: PUBLIC_DEMO_PROMPT_VERSION,
      contextVersion: PUBLIC_DEMO_CONTEXT_VERSION,
      contextLoaded: Boolean(publicChatContext),
      usedFantasyMcp: validationResult.usedFantasyMcp,
      prefetchedTransactions: Boolean(prefetchedTransactions),
      lastRefreshStatus: "completed",
      providerMeta: finalResult.sourceMeta,
    },
  };

  if (!options.dryRun) {
    await insertRefreshRun(refreshRun).catch((error) => {
      console.error("Failed to log public demo refresh run:", error);
    });
  }

  console.log(JSON.stringify(summarizeResult(finalResult), null, 2));
}

main().catch(async (error) => {
  const errorCode =
    error instanceof PublicDemoRefreshError
      ? error.code
      : "provider_failed";
  const message = sanitizeFailureMessage(
    error,
    errorCode === "provider_failed"
      ? "The AI provider command failed before a new answer could be stored."
      : "The latest refresh failed before a new answer could be stored.",
  );
  const options = (() => {
    try {
      return parseArgs(process.argv.slice(2));
    } catch {
      return null;
    }
  })();

  if (options?.presetId && isPublicChatDemoSport(options.sport)) {
    const completedAt = new Date().toISOString();
    await insertRefreshRun({
      job_type: "answer",
      preset_id: options.presetId,
      sport: options.sport,
      provider_attempted: options.provider || DEFAULT_PROVIDER,
      provider_model: options.model || null,
      status: "failed",
      error_code: errorCode,
      error_message: message,
      started_at: completedAt,
      completed_at: completedAt,
      duration_ms: null,
      source_meta: {
        dryRun: Boolean(options.dryRun),
      },
    }).catch(() => {});

    if (!options.dryRun) {
      await markPublicDemoAnswerRefreshFailure({
        presetId: options.presetId,
        sport: options.sport,
        provider: options.provider || DEFAULT_PROVIDER,
        providerModel: options.model || null,
        failureCode: errorCode,
        failureMessage: message,
        startedAt: completedAt,
        completedAt,
      }).catch(() => {});
    }
  }

  console.error(message);
  process.exitCode = 1;
});
