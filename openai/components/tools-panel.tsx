"use client";
import React from "react";
import McpConfig from "./mcp-config";
import PanelConfig from "./panel-config";
import UsageDisplay from "./usage-display";
import useToolsStore from "@/stores/useToolsStore";
import useOnboardingStore from "@/stores/useOnboardingStore";
import { getSportConfig } from "@/lib/onboarding/league-mapper";
import { User, Zap, Trophy, Settings, Pencil } from "lucide-react";
import useHasMounted from "@/hooks/useHasMounted";

export default function ContextPanel() {
  // Prevent SSR–client HTML mismatch while keeping hook order intact
  const hasMounted = useHasMounted();

  const {
    mcpEnabled,
    setMcpEnabled,
    selectedSport,
    selectedPlatform,
    isAuthenticated,
  } = useToolsStore();
  
  const {
    isComplete: onboardingComplete,
    selectedLeague,
    selectedPlatform: onboardingPlatform,
    espnLeagues,
    editLeague,
    resetOnboarding,
    activeLeagueKey,
    setActiveLeague
  } = useOnboardingStore();
  
  // Determine what to show based on onboarding completion
  const isConfiguredViaOnboarding = onboardingComplete && selectedLeague && onboardingPlatform;
  
  // Check if ESPN auth should be shown (either from onboarding or manual config)
  const shouldShowAuth = isConfiguredViaOnboarding 
    ? onboardingPlatform === 'ESPN'
    : selectedSport === "baseball" && selectedPlatform === "ESPN";
  
  // Check if MCP should be available (requires auth)
  const shouldShowMcp = shouldShowAuth && isAuthenticated;
  
  // Get sport configuration for display
  const sportConfig = isConfiguredViaOnboarding && selectedLeague 
    ? getSportConfig(selectedLeague.sport as any)
    : null;

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
        
        {/* Fantasy Teams Section (simplified) */}
        <PanelConfig
          title="Fantasy Teams"
          tooltip="Your configured fantasy teams"
          enabled={true}
          setEnabled={() => {}}
          showToggle={false}
          icon={<Trophy size={16} />}
          rightElement={
            <button
              type="button"
              onClick={resetOnboarding}
              className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Settings"
            >
              <Settings size={14} />
            </button>
          }
        >
          {espnLeagues?.length ? (
            <div className="space-y-3">
              {espnLeagues.map((league) => {
                const sportInfo = getSportConfig(league.sport as any);
                const displayLeagueName = league.leagueName || `League ${league.leagueId}`;
                const displayTeamName = league.teamName || (league.teamId ? `Team ${league.teamId}` : 'My Team');
                const isActive = activeLeagueKey === `${league.leagueId}-${league.sport}`;
                return (
                  <div key={`${league.leagueId}-${league.sport}`} className="relative">
                    <button
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
                    {/* Edit (pencil) button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        editLeague(league);
                      }}
                      title="Edit league"
                      className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No fantasy leagues configured yet.</p>
          )}
        </PanelConfig>
        
        {/* MCP Tools */}
        {shouldShowMcp && (
          <PanelConfig
            title={`Fantasy ${sportConfig?.name || 'Sports'} Tools (AI toggle)`}
            tooltip={`Turn this off to hide MCP tools from the AI (no tools advertised to OpenAI). Turn on to enable fantasy ${sportConfig?.name?.toLowerCase() || 'sports'} tools via ${onboardingPlatform || selectedPlatform} MCP.`}
            enabled={mcpEnabled}
            setEnabled={setMcpEnabled}
            icon={<Zap size={16} />}
          >
            <McpConfig />
          </PanelConfig>
        )}
        
        {/* Future Tools - Commented out but organized */}
        {/* 
        <PanelConfig
          title="Additional Tools"
          tooltip="Extra tools and features"
          enabled={false}
          setEnabled={() => {}}
          showToggle={false}
          icon={<Plus size={16} />}
        >
          <div className="space-y-4">
            <PanelConfig
              title="File Search"
              tooltip="Search your uploaded knowledge base"
              enabled={fileSearchEnabled}
              setEnabled={setFileSearchEnabled}
            >
              <FileSearchSetup />
            </PanelConfig>
            
            <PanelConfig
              title="Web Search"
              tooltip="Search the web for current information"
              enabled={webSearchEnabled}
              setEnabled={setWebSearchEnabled}
            >
              <WebSearchConfig />
            </PanelConfig>
            
            <PanelConfig
              title="Custom Functions"
              tooltip="Use locally defined custom functions"
              enabled={functionsEnabled}
              setEnabled={setFunctionsEnabled}
            >
              <FunctionsView />
            </PanelConfig>
          </div>
        </PanelConfig>
        */}
      </div>
    </div>
  );
}
