"use client";

import { Bug, Download } from "lucide-react";
import useToolsStore from "@/stores/chat/useToolsStore";
import useLeaguesStore from "@/stores/chat/useLeaguesStore";
import useConversationStore from "@/stores/chat/useConversationStore";
import { CollapsibleSection } from "./collapsible-section";
import { Switch } from "@/components/ui";
import { Button } from "@/components/ui/button";

export function DebugSection() {
  const {
    debugMode,
    setDebugMode,
    mcpConfig,
    mcpEnabled,
    isAuthenticated,
  } = useToolsStore();

  const { leagues, getActiveLeague } = useLeaguesStore();
  const { chatMessages, conversationItems, clearConversation } = useConversationStore();

  // Check if MCP should be available
  const shouldShow = leagues.length > 0 && isAuthenticated;

  if (!shouldShow) {
    return null;
  }

  const exportSession = () => {
    const activeLeague = getActiveLeague();
    const sessionData = {
      exportedAt: new Date().toISOString(),
      config: {
        mcpEnabled,
        mcpConfig: {
          server_label: mcpConfig.server_label,
          server_url: mcpConfig.server_url,
          allowed_tools: mcpConfig.allowed_tools,
          skip_approval: mcpConfig.skip_approval,
        },
        activeLeague: activeLeague ? {
          leagueId: activeLeague.leagueId,
          sport: activeLeague.sport,
          teamName: activeLeague.teamName,
        } : null,
      },
      conversation: {
        messageCount: chatMessages.length,
        messages: chatMessages,
        items: conversationItems,
      },
    };

    const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flaim-session-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <CollapsibleSection
      title="Debug Options"
      icon={<Bug size={16} />}
      defaultExpanded={false}
    >
      <div className="space-y-3">
        {/* Debug toggles */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Show raw JSON</span>
            <Switch
              checked={debugMode}
              onCheckedChange={setDebugMode}
            />
          </div>
          <p className="text-xs text-muted-foreground pl-1">
            Display request/response JSON and timing for tool calls.
          </p>
        </div>

        {/* Session actions */}
        <div className="pt-2 border-t border-border space-y-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportSession}
            className="w-full text-xs"
          >
            <Download className="h-3 w-3 mr-1" />
            Export Session
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={clearConversation}
            className="w-full text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            Clear Conversation
          </Button>
        </div>

        {/* Session stats */}
        <div className="text-xs text-muted-foreground text-center pt-1">
          {chatMessages.length} messages in session
        </div>
      </div>
    </CollapsibleSection>
  );
}
