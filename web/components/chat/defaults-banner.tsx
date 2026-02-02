"use client";

import React, { useState } from "react";
import useLeaguesStore, { SPORT_CONFIG } from "@/stores/chat/useLeaguesStore";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";

export default function DefaultsBanner() {
  const {
    defaultSport,
    leagues,
    getActiveLeague,
    getAvailableSports,
    getLeaguesForSport,
    setDefaultSport,
    setDefaultLeague,
    getSportConfig,
  } = useLeaguesStore();

  const [sportOpen, setSportOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);

  const activeLeague = getActiveLeague();
  const availableSports = getAvailableSports();

  // Nothing to show if no leagues
  if (leagues.length === 0) return null;

  const currentSport = defaultSport || activeLeague?.sport || availableSports[0];
  const sportConfig = currentSport ? getSportConfig(currentSport) : null;
  const sportLeagues = currentSport ? getLeaguesForSport(currentSport) : [];

  return (
    <div className="flex items-center gap-2">
      {/* Sport pill */}
      <Popover open={sportOpen} onOpenChange={setSportOpen}>
        <PopoverTrigger asChild>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-info/10 border border-info/30 text-info text-xs font-medium rounded-full hover:bg-info/20 transition-colors">
            {sportConfig ? `${sportConfig.emoji} ${sportConfig.name}` : "Sport"}
            <ChevronDown size={10} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-1" align="start">
          <div className="flex flex-col">
            {availableSports.map((sport) => {
              const cfg = SPORT_CONFIG[sport];
              if (!cfg) return null;
              const isActive = sport === currentSport;
              return (
                <button
                  key={sport}
                  onClick={() => {
                    setDefaultSport(sport);
                    setSportOpen(false);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors text-left ${
                    isActive
                      ? "bg-info/15 text-info font-medium"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <span>{cfg.emoji}</span>
                  <span>{cfg.name}</span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Team pill */}
      <Popover open={teamOpen} onOpenChange={setTeamOpen}>
        <PopoverTrigger asChild>
          <button className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-info/10 border border-info/30 text-info text-xs font-medium rounded-full hover:bg-info/20 transition-colors">
            {activeLeague
              ? `${activeLeague.leagueName || `League ${activeLeague.leagueId}`} · ${activeLeague.teamName || "My Team"}`
              : "No team"}
            <ChevronDown size={10} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-1" align="start">
          <div className="flex flex-col">
            {sportLeagues.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No leagues for this sport
              </p>
            )}
            {sportLeagues.map((league) => {
              const isActive = activeLeague && league.leagueId === activeLeague.leagueId && league.seasonYear === activeLeague.seasonYear;
              return (
                <button
                  key={`${league.leagueId}-${league.seasonYear}`}
                  onClick={() => {
                    setDefaultLeague(league);
                    setTeamOpen(false);
                  }}
                  className={`flex flex-col px-3 py-2 text-sm rounded-md transition-colors text-left ${
                    isActive
                      ? "bg-info/15 text-info font-medium"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <span>{league.leagueName || `League ${league.leagueId}`}</span>
                  <span className="text-xs text-muted-foreground">
                    {league.teamName || "My Team"} · {league.seasonYear ?? "Unknown"}
                  </span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
