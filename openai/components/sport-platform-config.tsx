"use client";

import React from "react";
import useToolsStore from "@/stores/useToolsStore";
import SportSelector from "./sport-selector";
import PlatformSelector from "./platform-selector";
import useHasMounted from "@/hooks/useHasMounted";

export default function SportPlatformConfig() {
  // Prevent SSR–client HTML mismatch while keeping hook order intact
  const hasMounted = useHasMounted();

  const { 
    selectedSport, 
    selectedPlatform, 
    setSelectedSport, 
    setSelectedPlatform,
    setMcpEnabled 
  } = useToolsStore();

  if (!hasMounted) {
    return <div />;
  }

  const handleClear = () => {
    setSelectedSport("none");
    setSelectedPlatform("None");
    setMcpEnabled(false);
  };

  const handleSportChange = (sport: string) => {
    setSelectedSport(sport);
    
    // Disable MCP when sport changes to None
    if (sport === "none") {
      setMcpEnabled(false);
    }
  };

  const handlePlatformChange = (platform: string) => {
    setSelectedPlatform(platform);
    
    // Disable MCP when platform changes to None
    if (platform === "None") {
      setMcpEnabled(false);
    }
  };

  const shouldShowMcp = selectedSport === "baseball" && selectedPlatform === "ESPN";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Select Platform</span>
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-secondary"
          onClick={handleClear}
        >
          Clear
        </button>
      </div>
      
      <div className="space-y-3">
        <div className="space-y-2">
          <label htmlFor="sport" className="text-sm text-muted-foreground">
            Sport
          </label>
          <SportSelector
            value={selectedSport}
            onChange={handleSportChange}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="platform" className="text-sm text-muted-foreground">
            Platform
          </label>
          <PlatformSelector
            value={selectedPlatform}
            onChange={handlePlatformChange}
          />
        </div>
      </div>

      {/* Status Messages */}
      {shouldShowMcp && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-2 text-green-800 dark:text-green-300 text-sm font-medium">
            ⚾ ESPN Fantasy Baseball Ready
          </div>
          <div className="text-green-700 dark:text-green-400 text-xs mt-1">
            Configuration complete. Enter credentials below to access your leagues.
          </div>
        </div>
      )}
      
      {!shouldShowMcp && (selectedSport !== "none" || selectedPlatform !== "None") && (
        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <div className="text-yellow-800 dark:text-yellow-300 text-sm font-medium">
            Select both Baseball + ESPN
          </div>
          <div className="text-yellow-700 dark:text-yellow-400 text-xs mt-1">
            Current selection: {selectedSport} + {selectedPlatform}
          </div>
        </div>
      )}
    </div>
  );
}