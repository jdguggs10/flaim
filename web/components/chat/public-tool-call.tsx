"use client";

import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  LoaderCircle,
} from "lucide-react";

interface PublicToolCallProps {
  name?: string | null;
  status: "in_progress" | "completed";
}

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

export function PublicToolCall({
  name,
  status,
}: PublicToolCallProps) {
  const copy = getToolCopy(name);

  return (
    <div className="w-fit max-w-[90%] rounded-[1rem] border border-border/80 bg-background/90 px-3 py-2.5 shadow-sm">
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
            status === "completed"
              ? "border-primary/20 bg-primary text-primary-foreground"
              : "border-border bg-muted text-foreground"
          )}
          aria-label={status === "completed" ? "Complete" : "Running"}
        >
          {status === "completed" ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <LoaderCircle className="h-3 w-3 animate-spin" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium leading-5 text-foreground">
            {copy.title}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {copy.description}
          </p>
        </div>
      </div>
    </div>
  );
}
