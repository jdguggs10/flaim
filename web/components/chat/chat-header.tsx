"use client";

import Link from "next/link";
import { Flame } from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { LeagueDropdown } from "./league-dropdown";
import { SeasonDropdown } from "./season-dropdown";
import { AccountHeaderButton } from "./account-header-button";
import { EspnHeaderButton } from "./espn-header-button";

type Environment = "development" | "preview" | "production";

const ENV_CONFIG: Record<Environment, { label: string; color: string; textColor: string }> = {
  development: {
    label: "DEV",
    color: "bg-success",
    textColor: "text-success-foreground",
  },
  preview: {
    label: "PREVIEW",
    color: "bg-warning",
    textColor: "text-warning-foreground",
  },
  production: {
    label: "PROD",
    color: "bg-destructive",
    textColor: "text-destructive-foreground",
  },
};

function detectEnvironment(): Environment {
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (vercelEnv === "preview") return "preview";
  if (vercelEnv === "production") return "production";
  if (process.env.NODE_ENV === "development") return "development";
  return "production";
}

/**
 * Minimal header for the chat page.
 * Shows logo, league dropdown, season dropdown, environment badge, and user avatar.
 */
export function ChatHeader() {
  const env = detectEnvironment();
  const config = ENV_CONFIG[env];

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b bg-background shrink-0">
      {/* Left: Logo + Account/ESPN + League + Season */}
      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-lg font-bold hover:opacity-80 transition-opacity"
        >
          <Flame className="h-5 w-5" />
          <span className="hidden sm:inline">Flaim</span>
        </Link>
        <AccountHeaderButton />
        <EspnHeaderButton />
        <LeagueDropdown />
        <SeasonDropdown />
      </div>

      {/* Right: Environment badge + User */}
      <div className="flex items-center gap-3">
        <span
          className={`px-2 py-0.5 text-xs font-bold rounded ${config.color} ${config.textColor}`}
        >
          {config.label}
        </span>
        <UserButton />
      </div>
    </header>
  );
}
