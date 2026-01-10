"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Settings, Copy, Check } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import useLeaguesStore from "@/stores/chat/useLeaguesStore";
import { getSportConfig } from "@/lib/chat/league-mapper";

/**
 * League dropdown for the chat header.
 * Selects the league (season selection is separate).
 */
export function LeagueDropdown() {
  const {
    leagues,
    setActiveLeague,
    getActiveLeague,
    fetchLeagues,
  } = useLeaguesStore();
  const { isLoaded, isSignedIn } = useUser();

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch leagues if not already loaded
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    fetchLeagues();
  }, [fetchLeagues, isLoaded, isSignedIn]);

  const activeLeague = getActiveLeague();
  const sportConfig = activeLeague ? getSportConfig(activeLeague.sport as any) : null;

  const leagueGroups = useMemo(() => {
    const map = new Map<string, typeof leagues>();
    leagues.forEach((league) => {
      const key = `${league.leagueId}-${league.sport}`;
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(league);
      } else {
        map.set(key, [league]);
      }
    });
    return Array.from(map.entries()).map(([key, items]) => {
      const sorted = [...items].sort(
        (a, b) => (b.seasonYear ?? 0) - (a.seasonYear ?? 0)
      );
      return { key, leagues: sorted };
    });
  }, [leagues]);

  const copyLeagueId = () => {
    if (activeLeague) {
      navigator.clipboard.writeText(activeLeague.leagueId.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handleLeagueGroupSwitch = (groupKey: string) => {
    const group = leagueGroups.find((item) => item.key === groupKey);
    if (!group || group.leagues.length === 0) return;

    const activeGroupKey = activeLeague ? `${activeLeague.leagueId}-${activeLeague.sport}` : null;
    const nextLeague = activeGroupKey === groupKey && activeLeague
      ? activeLeague
      : group.leagues[0];

    setActiveLeague(nextLeague);
    setOpen(false);
  };

  if (!activeLeague) {
    return (
      <Link
        href="/leagues"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        Set up leagues
      </Link>
    );
  }

  const activeGroupKey = activeLeague ? `${activeLeague.leagueId}-${activeLeague.sport}` : null;
  const otherGroups = leagueGroups.filter((group) => group.key !== activeGroupKey);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-secondary transition-colors text-sm"
        >
          <span>{sportConfig?.emoji}</span>
          <span className="font-medium max-w-[200px] truncate">
            {activeLeague.leagueName || `League ${activeLeague.leagueId}`}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-0">
        {/* Active league details */}
        <div className="p-3 border-b">
          <div className="flex items-center gap-2">
            <span className="text-lg">{sportConfig?.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {activeLeague.leagueName || `League ${activeLeague.leagueId}`}
              </div>
              <div className="text-xs text-muted-foreground">
                {activeLeague.teamName || "My Team"} • {activeLeague.seasonYear}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <span>ID: {activeLeague.leagueId}</span>
            <button
              type="button"
              onClick={copyLeagueId}
              className="p-1 rounded hover:bg-secondary transition-colors"
              title="Copy league ID"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          </div>
        </div>

        {/* Other leagues */}
        {otherGroups.length > 0 && (
          <div className="p-2 border-b max-h-48 overflow-y-auto">
            <div className="text-xs text-muted-foreground font-medium px-2 mb-1">
              Switch league:
            </div>
            {otherGroups.map((group) => {
              const league = group.leagues[0];
              const info = getSportConfig(league.sport as any);
              const uniqueKey = group.key;
              const seasonsCount = group.leagues.length;
              return (
                <button
                  key={uniqueKey}
                  type="button"
                  onClick={() => handleLeagueGroupSwitch(group.key)}
                  className="w-full text-left p-2 rounded hover:bg-secondary transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{info?.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">
                        {league.leagueName || `League ${league.leagueId}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {info?.name} • {seasonsCount} season{seasonsCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Manage leagues link */}
        <div className="p-2">
          <Link
            href="/leagues"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 w-full text-left p-2 rounded hover:bg-secondary transition-colors text-xs text-muted-foreground"
          >
            <Settings className="h-3 w-3" />
            Manage leagues
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
