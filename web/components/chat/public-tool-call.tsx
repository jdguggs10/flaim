"use client";

import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  LoaderCircle,
} from "lucide-react";

interface PublicToolCallProps {
  name?: string | null;
  status: "in_progress" | "completed";
  parsedArguments?: Record<string, unknown>;
}

const ARGUMENT_LABELS: Array<[string, string]> = [
  ["platform", ""],
  ["sport", ""],
  ["week", "Week"],
  ["query", "Search"],
  ["type", "Type"],
];

function getToolCopy(name?: string | null) {
  switch (name) {
    case "web_search_call":
    case "web_search":
      return {
        title: "Web search for news",
        description: "Checking current news, injuries, and performance context before answering.",
      };
    case "get_user_session":
      return {
        title: "Checking Gerry's leagues",
        description: "Looking up the leagues and teams available to analyze right now.",
      };
    case "get_roster":
      return {
        title: "Reviewing Gerry's roster",
        description: "Pulling the current roster so Flaim can spot strengths and weak spots.",
      };
    case "get_standings":
      return {
        title: "Checking the standings",
        description: "Seeing where Gerry's team sits and what the table looks like around it.",
      };
    case "get_matchups":
      return {
        title: "Looking at the matchup",
        description: "Checking who Gerry is facing and where the matchup could swing.",
      };
    case "get_free_agents":
      return {
        title: "Scanning free agents",
        description: "Looking for available players who fit Gerry's biggest needs.",
      };
    case "get_transactions":
      return {
        title: "Reviewing league activity",
        description: "Checking the adds, drops, waivers, and other moves around Gerry's league.",
      };
    case "get_league_info":
      return {
        title: "Pulling league context",
        description: "Loading the league details Flaim needs to make sense of the answer.",
      };
    case "get_players":
      return {
        title: "Checking player details",
        description: "Looking up player-level details to sharpen the recommendation.",
      };
    default:
      return {
        title: "Checking live league data",
        description: "Reading Gerry's current league data before answering.",
      };
  }
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

    if (!label) {
      return String(value);
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
  const copy = getToolCopy(name);

  return (
    <div className="overflow-hidden rounded-[1.35rem] border border-border bg-card px-4 py-3.5 shadow-sm lg:rounded-[1.75rem]">
      <div className="mb-1.5 flex items-start justify-between gap-2.5">
        <div className="min-w-0 pr-2 text-[0.95rem] font-semibold leading-6 text-foreground">
          {copy.title}
        </div>
        <div
          className={cn(
            "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
            status === "completed"
              ? "border-border bg-primary text-primary-foreground"
              : "border-border bg-muted text-foreground"
          )}
          aria-label={status === "completed" ? "Complete" : "Running"}
        >
          {status === "completed" ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          )}
        </div>
      </div>

      <p className="text-sm leading-6 text-muted-foreground">
        {copy.description}
      </p>
      {argumentSummary.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {argumentSummary.map((item) => (
            <span
              key={item}
              className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
