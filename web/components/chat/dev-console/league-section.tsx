"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Trophy, Settings } from "lucide-react";
import useLeaguesStore, { makeLeagueKey } from "@/stores/chat/useLeaguesStore";
import { getSportConfig } from "@/lib/chat/league-mapper";
import { CollapsibleSection } from "./collapsible-section";
import { CopyButton } from "./copy-button";

export function LeagueSection() {
  const {
    leagues,
    activeLeagueKey,
    setActiveLeague,
    getActiveLeague,
    fetchLeagues,
  } = useLeaguesStore();

  // Fetch leagues if not already loaded
  useEffect(() => {
    fetchLeagues();
  }, [fetchLeagues]);

  const activeLeague = getActiveLeague();

  return (
    <CollapsibleSection
      title="Active League"
      icon={<Trophy size={16} />}
      defaultExpanded={true}
      rightElement={
        <Link
          href="/leagues"
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Manage leagues"
        >
          <Settings size={14} />
        </Link>
      }
    >
      {leagues.length > 0 ? (
        <div className="space-y-3">
          {/* Active league details */}
          {activeLeague && (
            <div className="p-2 bg-primary/10 border border-primary/20 rounded-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">
                    {getSportConfig(activeLeague.sport as any)?.emoji}
                  </span>
                  <div>
                    <div className="text-sm font-medium">
                      {activeLeague.leagueName || `League ${activeLeague.leagueId}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {activeLeague.teamName || "My Team"} • {activeLeague.seasonYear}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <span>ID: {activeLeague.leagueId}</span>
                <CopyButton value={activeLeague.leagueId.toString()} />
              </div>
            </div>
          )}

          {/* Other leagues */}
          {leagues.length > 1 && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground font-medium">
                Switch league:
              </div>
              {leagues
                .filter((league) => makeLeagueKey(league) !== activeLeagueKey)
                .map((league) => {
                  const sportInfo = getSportConfig(league.sport as any);
                  const uniqueKey = makeLeagueKey(league);
                  return (
                    <button
                      key={uniqueKey}
                      type="button"
                      onClick={() => setActiveLeague(league)}
                      className="w-full text-left p-2 border border-border rounded-md hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{sportInfo?.emoji}</span>
                        <div className="text-xs">
                          <div className="font-medium">
                            {league.leagueName || `League ${league.leagueId}`}
                          </div>
                          <div className="text-muted-foreground">
                            {sportInfo?.name} • {league.seasonYear}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-2">
          <p className="text-xs text-muted-foreground mb-2">
            No fantasy leagues configured.
          </p>
          <Link
            href="/leagues"
            className="text-xs text-primary hover:underline"
          >
            Set up your leagues
          </Link>
        </div>
      )}
    </CollapsibleSection>
  );
}
