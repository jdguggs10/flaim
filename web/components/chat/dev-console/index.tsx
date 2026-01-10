"use client";

import useHasMounted from "@/hooks/useHasMounted";
import { McpSection } from "./mcp-section";
import { ToolsSection } from "./tools-section";
import { DebugSection } from "./debug-section";

/**
 * Developer Console - Enhanced sidebar for MCP debugging.
 * Environment badge and league selector are now in the chat header.
 */
export default function DevConsole() {
  const hasMounted = useHasMounted();

  if (!hasMounted) {
    return <div className="h-full p-4 lg:p-6 w-full" />;
  }

  return (
    <div className="h-full p-4 lg:p-6 w-full bg-muted/50 lg:rounded-none flex flex-col">
      <div className="flex flex-col space-y-4 flex-1 min-h-0 overflow-y-auto">
        {/* MCP Section */}
        <McpSection />

        {/* Available Tools */}
        <ToolsSection />

        {/* Debug Options */}
        <DebugSection />
      </div>
    </div>
  );
}
