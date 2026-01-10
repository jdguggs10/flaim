"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import useLeaguesStore from "@/stores/chat/useLeaguesStore";

/**
 * Season dropdown for the chat header.
 * Lets you switch seasons within the currently selected league.
 */
export function SeasonDropdown() {
  const { leagues, getActiveLeague, setActiveLeague } = useLeaguesStore();
  const [open, setOpen] = useState(false);

  const activeLeague = getActiveLeague();

  const seasons = useMemo(() => {
    if (!activeLeague) return [];
    const groupKey = `${activeLeague.leagueId}-${activeLeague.sport}`;
    return leagues
      .filter((league) => `${league.leagueId}-${league.sport}` === groupKey)
      .sort((a, b) => (b.seasonYear ?? 0) - (a.seasonYear ?? 0));
  }, [leagues, activeLeague]);

  if (!activeLeague) {
    return null;
  }

  const activeSeason = activeLeague.seasonYear ?? "Unknown";
  const activeTeam = activeLeague.teamName || "My Team";

  const handleSeasonSwitch = (seasonYear?: number) => {
    const match = seasons.find((league) => league.seasonYear === seasonYear);
    if (match) {
      setActiveLeague(match);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary transition-colors text-sm"
        >
          <span className="font-medium">{`${activeSeason} - ${activeTeam}`}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40 p-1">
        {seasons.map((league) => {
          const seasonLabel = league.seasonYear ?? "Unknown";
          const teamLabel = league.teamName || "My Team";
          const isActive = league.seasonYear === activeLeague.seasonYear;
          return (
            <button
              key={`${league.leagueId}-${league.sport}-${seasonLabel}`}
              type="button"
              onClick={() => handleSeasonSwitch(league.seasonYear)}
              className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                isActive ? "bg-secondary text-foreground" : "hover:bg-secondary/50"
              }`}
            >
              {seasonLabel} - {teamLabel}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
