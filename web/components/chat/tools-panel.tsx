"use client";
import React, { useEffect } from "react";
import Link from "next/link";
import McpConfig from "./mcp-config";
import PanelConfig from "./panel-config";
import UsageDisplay from "./usage-display";
import useToolsStore from "@/stores/chat/useToolsStore";
import useLeaguesStore from "@/stores/chat/useLeaguesStore";
import { getSportConfig } from "@/lib/chat/league-mapper";
import { User, Zap, Trophy, Settings, Bug } from "lucide-react";
import useHasMounted from "@/hooks/useHasMounted";

export default function ContextPanel() {
  // Prevent SSR–client HTML mismatch while keeping hook order intact
  const hasMounted = useHasMounted();

  const {
    mcpEnabled,
    setMcpEnabled,
    selectedPlatform,
    isAuthenticated,
    debugMode,
    setDebugMode,
  } = useToolsStore();

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

  // Check if MCP should be available (requires leagues and auth)
  const shouldShowMcp = leagues.length > 0 && isAuthenticated;

  // Get sport configuration for display
  const sportConfig = activeLeague ? getSportConfig(activeLeague.sport as any) : null;

  if (!hasMounted) {
    return <div className="h-full p-4 lg:p-8 w-full" />; // Skeleton placeholder
  }

  return (
    <div className="h-full p-4 lg:p-8 w-full bg-muted/50 lg:rounded-none">
      <div className="flex flex-col space-y-6 h-full overflow-y-auto">
        {/* Account & Usage Section */}
        <PanelConfig
          title="Account & Usage"
          tooltip="View your current plan and message usage"
          enabled={true}
          setEnabled={() => {}}
          showToggle={false}
          icon={<User size={16} />}
        >
          <UsageDisplay />
        </PanelConfig>

        {/* Fantasy Teams Section */}
        <PanelConfig
          title="Fantasy Teams"
          tooltip="Your configured fantasy teams"
          enabled={true}
          setEnabled={() => {}}
          showToggle={false}
          icon={<Trophy size={16} />}
          rightElement={
            <Link
              href="/leagues"
              className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Manage leagues"
            >
              <Settings size={14} />
            </Link>
          }
        >
          {leagues.length > 0 ? (
            <div className="space-y-3">
              {leagues.map((league) => {
                const sportInfo = getSportConfig(league.sport as any);
                const displayLeagueName = league.leagueName || `League ${league.leagueId}`;
                const displayTeamName = league.teamName || (league.teamId ? `Team ${league.teamId}` : 'My Team');
                const isActive = activeLeagueKey === `${league.leagueId}-${league.sport}`;
                return (
                  <button
                    key={`${league.leagueId}-${league.sport}`}
                    type="button"
                    onClick={() => setActiveLeague(league)}
                    className={`w-full text-left p-3 border rounded-lg transition-colors ${isActive ? 'border-primary bg-primary/10' : 'border-border bg-secondary hover:bg-secondary/60'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg" aria-hidden="true">{sportInfo?.emoji}</span>
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {displayLeagueName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {displayTeamName} • {sportInfo?.name}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-2">No fantasy leagues configured yet.</p>
              <Link
                href="/leagues"
                className="text-sm text-primary hover:underline"
              >
                Set up your leagues
              </Link>
            </div>
          )}
        </PanelConfig>

        {/* MCP Tools */}
        {shouldShowMcp && (
          <PanelConfig
            title={`Fantasy ${sportConfig?.name || 'Sports'} Tools (AI toggle)`}
            tooltip={`Turn this off to hide MCP tools from the AI. Turn on to enable fantasy ${sportConfig?.name?.toLowerCase() || 'sports'} tools via ${selectedPlatform} MCP.`}
            enabled={mcpEnabled}
            setEnabled={setMcpEnabled}
            icon={<Zap size={16} />}
          >
            <McpConfig />
          </PanelConfig>
        )}

        {/* Debug Mode */}
        {shouldShowMcp && (
          <PanelConfig
            title="Debug Mode"
            tooltip="Show raw tool request/response JSON and timing information for debugging MCP tools"
            enabled={debugMode}
            setEnabled={setDebugMode}
            icon={<Bug size={16} />}
          >
            <p className="text-xs text-muted-foreground">
              When enabled, tool calls will display raw JSON requests/responses and execution timing.
            </p>
          </PanelConfig>
        )}
      </div>
    </div>
  );
}
