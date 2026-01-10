"use client";

import { Wrench, Square, CheckSquare } from "lucide-react";
import useToolsStore from "@/stores/chat/useToolsStore";
import useLeaguesStore from "@/stores/chat/useLeaguesStore";
import { SPORT_CONFIG, type Sport } from "@/lib/chat/league-mapper";
import { CollapsibleSection } from "./collapsible-section";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Tool descriptions for tooltips
const TOOL_DESCRIPTIONS: Record<string, string> = {
  get_espn_baseball_league_info: "Get league settings, scoring categories, and team list",
  get_espn_baseball_team_roster: "Get a team's full roster with player stats",
  get_espn_baseball_matchups: "Get current and upcoming matchup details",
  get_espn_baseball_standings: "Get league standings and records",
  get_espn_football_league_info: "Get league settings and team list",
  get_espn_football_team: "Get team roster and player details",
  get_espn_football_matchups: "Get weekly matchup scores and projections",
  get_espn_basketball_league_info: "Get league settings and team list",
  get_espn_basketball_team: "Get team roster and player details",
  get_espn_basketball_matchups: "Get matchup scores and stats",
  get_espn_hockey_league_info: "Get league settings and team list",
  get_espn_hockey_team: "Get team roster and player details",
  get_espn_hockey_matchups: "Get matchup scores and stats",
};

export function ToolsSection() {
  const { mcpEnabled, mcpConfig, setMcpConfig, isAuthenticated } = useToolsStore();
  const { leagues, getActiveLeague } = useLeaguesStore();
  const activeLeague = getActiveLeague();

  // Parse enabled tools from CSV
  // "none" sentinel means all tools disabled; empty string means no restriction (all enabled)
  const rawAllowedTools = mcpConfig.allowed_tools || "";
  const isAllDisabled = rawAllowedTools.trim() === "none";
  const enabledTools = isAllDisabled
    ? []
    : rawAllowedTools.split(",").map(t => t.trim()).filter(Boolean);

  // Check if MCP should be available
  const shouldShow = leagues.length > 0 && isAuthenticated && mcpEnabled;

  if (!shouldShow || !activeLeague) {
    return null;
  }

  const sport = activeLeague.sport as Sport;
  const availableTools = SPORT_CONFIG[sport]?.mcpTools || [];

  const toggleTool = (toolName: string) => {
    // If currently "none" (all disabled), start fresh with just this tool
    if (isAllDisabled) {
      setMcpConfig({ ...mcpConfig, allowed_tools: toolName });
      return;
    }

    const newTools = enabledTools.includes(toolName)
      ? enabledTools.filter(t => t !== toolName)
      : [...enabledTools, toolName];

    // If no tools remain, use "none" sentinel
    const newValue = newTools.length === 0 ? "none" : newTools.join(",");
    setMcpConfig({ ...mcpConfig, allowed_tools: newValue });
  };

  const enableAll = () => {
    setMcpConfig({ ...mcpConfig, allowed_tools: availableTools.join(",") });
  };

  const disableAll = () => {
    // Use "none" sentinel to explicitly disable all tools
    setMcpConfig({ ...mcpConfig, allowed_tools: "none" });
  };

  return (
    <CollapsibleSection
      title="Available Tools"
      icon={<Wrench size={16} />}
      defaultExpanded={false}
    >
      <div className="space-y-3">
        {/* Tool list */}
        <div className="space-y-1">
          {availableTools.map((tool) => {
            // If no specific tools listed (empty, not "none"), all are enabled
            const noRestriction = !isAllDisabled && enabledTools.length === 0;
            const isEnabled = noRestriction || enabledTools.includes(tool);
            const description = TOOL_DESCRIPTIONS[tool] || "No description available";

            return (
              <TooltipProvider key={tool} delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => toggleTool(tool)}
                      className="w-full flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors text-left"
                    >
                      {isEnabled ? (
                        <CheckSquare className="h-4 w-4 text-primary flex-shrink-0" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <span className={`text-xs font-mono truncate ${isEnabled ? "text-foreground" : "text-muted-foreground"}`}>
                        {tool}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-xs">{description}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>

        {/* Bulk actions */}
        <div className="flex gap-2 pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={enableAll}
            className="flex-1 text-xs"
          >
            Enable All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={disableAll}
            className="flex-1 text-xs"
          >
            Disable All
          </Button>
        </div>

        {/* Current state indicator */}
        <div className="text-xs text-muted-foreground text-center">
          {isAllDisabled
            ? "0"
            : enabledTools.length === 0
              ? availableTools.length
              : enabledTools.length} of {availableTools.length} tools enabled
        </div>
      </div>
    </CollapsibleSection>
  );
}
