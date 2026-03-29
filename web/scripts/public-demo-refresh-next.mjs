import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { PUBLIC_CHAT_PRESETS } from "../lib/public-chat.ts";
import {
  DEFAULT_GEMINI_BIN,
  DEFAULT_SCHEDULER_EXPIRES_MINUTES,
  DEFAULT_SCHEDULER_PROVIDER,
  DEFAULT_SCHEDULER_STALE_MINUTES,
  fetchCurrentPublicDemoAnswerRows,
  getProjectRoot,
  isPublicChatDemoSport,
  loadProjectEnv,
  parsePositiveInteger,
  toTime,
} from "./public-demo-refresh-shared.mjs";

const execFileAsync = promisify(execFile);

function printUsage() {
  console.log(`Usage:
  npm run public-demo:refresh-next -- --sport <baseball|football> [options]

Options:
  --sport <sport>            Demo sport: baseball or football (required)
  --provider <name>          Provider to use (default: gemini)
  --model <name>             Optional provider model override
  --expires-minutes <n>      Cache expiry boundary in minutes (default: 240)
  --stale-minutes <n>        Stale boundary in minutes (default: 720)
  --gemini-bin <path>        Gemini CLI binary path (default: gemini)
  --select-only              Print the chosen preset and stop before provider execution
  --dry-run                  Pass through to the refresh runner without writing cache rows
  --verbose                  Print extra scheduling details
  --help                     Show this help
`);
}

function parseArgs(argv) {
  const options = {
    provider: DEFAULT_SCHEDULER_PROVIDER,
    expiresMinutes: DEFAULT_SCHEDULER_EXPIRES_MINUTES,
    staleMinutes: DEFAULT_SCHEDULER_STALE_MINUTES,
    geminiBin: process.env.PUBLIC_DEMO_GEMINI_BIN?.trim() || DEFAULT_GEMINI_BIN,
    dryRun: false,
    selectOnly: false,
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

    if (arg === "--select-only") {
      options.selectOnly = true;
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

function getCandidatePriority(row) {
  if (!row) {
    return { priority: 0, reason: "missing" };
  }

  if (row.status && row.status !== "ready") {
    return { priority: 1, reason: row.status };
  }

  const now = Date.now();
  const staleAfter = toTime(row.stale_after);
  if (Number.isFinite(staleAfter) && staleAfter <= now) {
    return { priority: 2, reason: "stale" };
  }

  const expiresAt = toTime(row.expires_at);
  if (Number.isFinite(expiresAt) && expiresAt <= now) {
    return { priority: 3, reason: "expired" };
  }

  return { priority: 4, reason: "rotation" };
}

function getSortTimestamp(row) {
  if (!row) {
    return Number.NEGATIVE_INFINITY;
  }

  const generatedAt = toTime(row.generated_at);
  if (Number.isFinite(generatedAt)) {
    return generatedAt;
  }

  const updatedAt = toTime(row.updated_at);
  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }

  return Number.POSITIVE_INFINITY;
}

async function selectNextCandidate(sport) {
  const rows = await fetchCurrentPublicDemoAnswerRows(sport);
  const rowsByPresetId = new Map(rows.map((row) => [row.preset_id, row]));

  const candidates = PUBLIC_CHAT_PRESETS.map((preset, index) => {
    const row = rowsByPresetId.get(preset.id) ?? null;
    const { priority, reason } = getCandidatePriority(row);

    return {
      preset,
      row,
      priority,
      reason,
      sortTimestamp: getSortTimestamp(row),
      presetIndex: index,
    };
  });

  candidates.sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    if (left.sortTimestamp !== right.sortTimestamp) {
      return left.sortTimestamp - right.sortTimestamp;
    }

    return left.presetIndex - right.presetIndex;
  });

  return candidates[0] ?? null;
}

async function runSelectedRefresh(projectRoot, candidate, options) {
  const refreshScriptPath = path.join(projectRoot, "scripts", "public-demo-refresh.mjs");
  const args = [
    "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    "--experimental-strip-types",
    refreshScriptPath,
    "--preset",
    candidate.preset.id,
    "--sport",
    options.sport,
    "--provider",
    options.provider,
    "--expires-minutes",
    String(options.expiresMinutes),
    "--stale-minutes",
    String(options.staleMinutes),
    "--gemini-bin",
    options.geminiBin,
  ];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.dryRun) {
    args.push("--dry-run");
  }

  if (options.verbose) {
    args.push("--verbose");
  }

  const { stdout, stderr } = await execFileAsync(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

async function main() {
  const projectRoot = getProjectRoot(import.meta.url);
  loadProjectEnv(projectRoot);

  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!isPublicChatDemoSport(options.sport)) {
    throw new Error("--sport must be baseball or football");
  }

  if (options.provider !== "gemini") {
    throw new Error(`Unsupported provider for Phase 3: ${options.provider}`);
  }

  if (options.staleMinutes < options.expiresMinutes) {
    throw new Error("--stale-minutes must be greater than or equal to --expires-minutes");
  }

  const candidate = await selectNextCandidate(options.sport);
  if (!candidate) {
    throw new Error(`No public demo presets are configured for ${options.sport}`);
  }

  const selectionSummary = {
    presetId: candidate.preset.id,
    title: candidate.preset.title,
    sport: options.sport,
    reason: candidate.reason,
    existingStatus: candidate.row?.status ?? "missing",
    generatedAt: candidate.row?.generated_at ?? null,
    expiresAt: candidate.row?.expires_at ?? null,
    staleAfter: candidate.row?.stale_after ?? null,
  };

  if (options.verbose) {
    console.error(JSON.stringify(selectionSummary, null, 2));
  }

  if (options.selectOnly) {
    console.log(JSON.stringify({ selection: selectionSummary }, null, 2));
    return;
  }

  const result = await runSelectedRefresh(projectRoot, candidate, options);
  const parsedResult = result.stdout ? JSON.parse(result.stdout) : null;

  console.log(
    JSON.stringify(
      {
        selection: selectionSummary,
        refreshResult: parsedResult,
      },
      null,
      2,
    ),
  );

  if (result.stderr) {
    console.error(result.stderr);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
