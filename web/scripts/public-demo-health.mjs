import process from "node:process";

import { PUBLIC_CHAT_PRESETS } from "../lib/public-chat.ts";
import {
  fetchCurrentPublicDemoAnswerRows,
  fetchRecentPublicDemoRefreshRuns,
  formatRelativeAge,
  getProjectRoot,
  isPublicChatDemoSport,
  loadProjectEnv,
  toTime,
  truncateText,
} from "./public-demo-refresh-shared.mjs";

function printUsage() {
  console.log(`Usage:
  npm run public-demo:health -- --sport <baseball|football> [options]

Options:
  --sport <sport>    Demo sport: baseball or football (required)
  --json             Print machine-readable JSON instead of a text report
  --help             Show this help
`);
}

function parseArgs(argv) {
  const options = {
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
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
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  return options;
}

function getLatestRunByPreset(runs) {
  const latest = new Map();

  for (const run of runs) {
    if (!run?.preset_id || latest.has(run.preset_id)) {
      continue;
    }

    latest.set(run.preset_id, run);
  }

  return latest;
}

function formatFailureMessage(message) {
  if (typeof message !== "string" || message.length === 0) {
    return "";
  }

  if (message.startsWith("Command failed:")) {
    return "The AI provider command failed before a new answer could be stored.";
  }

  return truncateText(message, 120);
}

function buildPresetHealth(preset, row, latestRun) {
  const now = Date.now();
  const expiresAtTime = toTime(row?.expires_at);
  const staleAfterTime = toTime(row?.stale_after);
  const isExpired = Number.isFinite(expiresAtTime) && expiresAtTime <= now;
  const isStale = Number.isFinite(staleAfterTime) && staleAfterTime <= now;

  let displayStatus = "ready";
  if (!row) {
    displayStatus = "missing";
  } else if (row.status && row.status !== "ready") {
    displayStatus = row.status;
  } else if (isStale) {
    displayStatus = "stale";
  } else if (isExpired) {
    displayStatus = "expired";
  }

  return {
    presetId: preset.id,
    title: preset.title,
    homepageSection: preset.homepageSection,
    displayStatus,
    cacheStatus: row?.status ?? "missing",
    generatedAt: row?.generated_at ?? null,
    generatedAge: row?.generated_at ? formatRelativeAge(row.generated_at) : "never",
    expiresAt: row?.expires_at ?? null,
    staleAfter: row?.stale_after ?? null,
    provider: row?.provider ?? null,
    providerModel: row?.provider_model ?? null,
    latestRunStatus: latestRun?.status ?? null,
    latestRunCompletedAt: latestRun?.completed_at ?? null,
    latestRunAge: latestRun?.completed_at
      ? formatRelativeAge(latestRun.completed_at)
      : "n/a",
    latestErrorCode: latestRun?.error_code ?? null,
    latestErrorMessage: latestRun?.error_message ?? null,
  };
}

function buildHealthSummary(sport, rows, runs) {
  const rowsByPreset = new Map(rows.map((row) => [row.preset_id, row]));
  const latestRunsByPreset = getLatestRunByPreset(runs);
  const presets = PUBLIC_CHAT_PRESETS.map((preset) =>
    buildPresetHealth(
      preset,
      rowsByPreset.get(preset.id) ?? null,
      latestRunsByPreset.get(preset.id) ?? null,
    ),
  );

  const counts = presets.reduce(
    (totals, preset) => {
      totals.total += 1;
      totals[preset.displayStatus] = (totals[preset.displayStatus] ?? 0) + 1;
      return totals;
    },
    {
      total: 0,
      ready: 0,
      degraded: 0,
      missing: 0,
      expired: 0,
      stale: 0,
      disabled: 0,
    },
  );

  const worstPreset =
    presets.find((preset) => preset.displayStatus === "missing") ??
    presets.find((preset) => preset.displayStatus === "degraded") ??
    presets.find((preset) => preset.displayStatus === "stale") ??
    presets.find((preset) => preset.displayStatus === "expired") ??
    [...presets]
      .filter((preset) => preset.generatedAt)
      .sort((left, right) => toTime(left.generatedAt) - toTime(right.generatedAt))[0] ??
    null;

  const latestFailure =
    runs.find((run) => run.status === "failed" && run.preset_id) ?? null;

  return {
    sport,
    generatedAt: new Date().toISOString(),
    counts,
    worstPreset,
    latestFailure: latestFailure
      ? {
          presetId: latestFailure.preset_id,
          completedAt: latestFailure.completed_at ?? null,
          age: latestFailure.completed_at
            ? formatRelativeAge(latestFailure.completed_at)
            : "n/a",
          errorCode: latestFailure.error_code ?? null,
          errorMessage: latestFailure.error_message ?? null,
        }
      : null,
    presets,
  };
}

function printTextHealth(summary) {
  const lines = [
    `Public demo cache health for ${summary.sport}`,
    `Counts: ${summary.counts.total} total | ${summary.counts.ready} ready | ${summary.counts.degraded} degraded | ${summary.counts.expired} expired | ${summary.counts.stale} stale | ${summary.counts.missing} missing`,
  ];

  if (summary.worstPreset) {
    lines.push(
      `Next concern: ${summary.worstPreset.presetId} (${summary.worstPreset.displayStatus}, generated ${summary.worstPreset.generatedAge})`,
    );
  }

  if (summary.latestFailure) {
    lines.push(
      `Latest failure: ${summary.latestFailure.presetId} ${summary.latestFailure.errorCode ?? "failed"} ${summary.latestFailure.age}`,
    );
    if (summary.latestFailure.errorMessage) {
      lines.push(`  ${formatFailureMessage(summary.latestFailure.errorMessage)}`);
    }
  }

  lines.push("");
  lines.push("Preset status:");

  for (const preset of summary.presets) {
    const row = [
      preset.presetId.padEnd(20),
      preset.displayStatus.padEnd(8),
      `generated ${preset.generatedAge}`.padEnd(22),
      `latest run ${preset.latestRunAge}`.padEnd(20),
    ];

    if (preset.latestErrorCode) {
      row.push(`${preset.latestErrorCode}: ${formatFailureMessage(preset.latestErrorMessage)}`);
    }

    lines.push(row.join(" | "));
  }

  console.log(lines.join("\n"));
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

  const [rows, runs] = await Promise.all([
    fetchCurrentPublicDemoAnswerRows(options.sport),
    fetchRecentPublicDemoRefreshRuns(options.sport),
  ]);

  const summary = buildHealthSummary(options.sport, rows, runs);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printTextHealth(summary);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
