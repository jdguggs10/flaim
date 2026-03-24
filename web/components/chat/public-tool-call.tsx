"use client";

import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  LoaderCircle,
  Radio,
  Sparkles,
  Telescope,
} from "lucide-react";

interface PublicToolCallProps {
  name?: string | null;
  status: "in_progress" | "completed";
  parsedArguments?: Record<string, unknown>;
}

const ARGUMENT_LABELS: Array<[string, string]> = [
  ["platform", "Platform"],
  ["sport", "Sport"],
  ["league_id", "League"],
  ["season_year", "Season"],
  ["team_id", "Team"],
  ["week", "Week"],
  ["query", "Query"],
  ["player_name", "Player"],
  ["type", "Type"],
  ["limit", "Limit"],
];

function formatToolName(name?: string | null) {
  if (!name) {
    return "Live tool call";
  }

  return name
    .replace(/^get_/, "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeArguments(parsedArguments?: Record<string, unknown>) {
  if (!parsedArguments) {
    return [];
  }

  return ARGUMENT_LABELS.flatMap(([key, label]) => {
    const value = parsedArguments[key];
    if (value === undefined || value === null || value === "") {
      return [];
    }
    return `${label}: ${String(value)}`;
  });
}

export function PublicToolCall({
  name,
  status,
  parsedArguments,
}: PublicToolCallProps) {
  const argumentSummary = summarizeArguments(parsedArguments);

  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-white/60 bg-white/75 px-4 py-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-900/10 bg-slate-950 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white">
          <Telescope className="h-3.5 w-3.5 text-cyan-300" />
          Live tool call
        </div>
        <div
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold",
            status === "completed"
              ? "bg-emerald-500/12 text-emerald-700"
              : "bg-amber-500/12 text-amber-700"
          )}
        >
          {status === "completed" ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          )}
          {status === "completed" ? "Complete" : "Running"}
        </div>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Sparkles className="h-4 w-4 text-fuchsia-500" />
            <span>{formatToolName(name)}</span>
          </div>
          {argumentSummary.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {argumentSummary.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-slate-900/10 bg-slate-900/[0.03] px-2.5 py-1 text-xs text-slate-600"
                >
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              Inspecting Gerry&apos;s live league data.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-slate-900/8 pt-3 text-xs text-slate-500">
        <Radio className="h-3.5 w-3.5 text-cyan-600" />
        Live data from Gerry&apos;s actual leagues
      </div>
    </div>
  );
}
