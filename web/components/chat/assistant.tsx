"use client";
import React, { useEffect, useState } from "react";
import { useUser, SignInButton, SignUpButton, useAuth } from '@clerk/nextjs';
import Chat from "./chat";
import useConversationStore from "@/stores/chat/useConversationStore";
import { Item, processMessages } from "@/lib/chat/assistant";
import useToolsStore from "@/stores/chat/useToolsStore";
import useLeaguesStore from "@/stores/chat/useLeaguesStore";
import { generateMcpToolsConfig } from "@/lib/chat/league-mapper";
import useHasMounted from "@/hooks/useHasMounted";
import { AlertCircle, ArrowRight } from "lucide-react";
import Link from "next/link";

/**
 * Setup banner shown when user hasn't completed ESPN configuration
 */
function SetupBanner({ status }: { status: { hasCredentials: boolean; hasLeagues: boolean; hasDefaultTeam: boolean } }) {
  let message = "";
  let linkText = "Set up on Leagues";

  if (!status.hasCredentials) {
    message = "Connect your ESPN account to get started.";
  } else if (!status.hasLeagues) {
    message = "Add a fantasy league to continue.";
    linkText = "Go to Leagues";
  } else if (!status.hasDefaultTeam) {
    message = "Select your default team to get started.";
    linkText = "Go to Leagues";
  }

  if (!message) return null;

  return (
    <div className="mx-4 mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3">
      <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
      <div className="flex-1">
        <p className="text-sm text-amber-800">{message}</p>
      </div>
      <Link
        href="/leagues"
        className="flex items-center gap-1 text-sm font-medium text-amber-700 hover:text-amber-900 transition-colors"
      >
        {linkText}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

export default function Assistant() {
  // Prevent SSR–client HTML mismatch while keeping hook order intact
  const hasMounted = useHasMounted();
  const [setupChecked, setSetupChecked] = useState(false);

  const { chatMessages, addConversationItem, addChatMessage, setAssistantLoading } =
    useConversationStore();

  const handleSendMessage = async (message: string) => {
    if (!message.trim()) return;

    const userItem: Item = {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: message.trim() }],
    };
    const userMessage: any = {
      role: "user",
      content: message.trim(),
    };

    try {
      setAssistantLoading(true);
      addConversationItem(userMessage);
      addChatMessage(userItem);
      await processMessages();
    } catch (error) {
      console.error("Error processing message:", error);
    }
  };

  const handleApprovalResponse = async (
    approve: boolean,
    id: string
  ) => {
    const approvalItem = {
      type: "mcp_approval_response",
      approve,
      approval_request_id: id,
    } as any;
    try {
      addConversationItem(approvalItem);
      await processMessages();
    } catch (error) {
      console.error("Error sending approval response:", error);
    }
  };

  const { isSignedIn, isLoaded } = useUser();
  const isLoading = !isLoaded;

  // Leagues store
  const {
    leagues,
    setupStatus,
    fetchSetupStatus,
    fetchLeagues,
    getActiveLeague,
  } = useLeaguesStore();

  // Tools store
  const {
    setMcpEnabled,
    setMcpConfig,
    setSelectedSport,
    setSelectedPlatform: setToolsPlatform,
    setIsAuthenticated: setToolsAuthenticated,
    setClerkUserId,
    setClerkToken
  } = useToolsStore();

  // Sync Clerk identity + token into tools store for MCP auth headers
  const { userId: clerkUserId, getToken } = useAuth();
  const mcpGloballyDisabled = process.env.NEXT_PUBLIC_DISABLE_MCP === "true";

  useEffect(() => {
    const syncClerkAuth = async () => {
      if (!isSignedIn || isLoading) return;
      setClerkUserId(clerkUserId || "");
      try {
        const token = (await getToken?.({ template: "cf-worker" })) || "";
        if (token) {
          setClerkToken(token);
        }
      } catch (error) {
        console.warn("Unable to fetch Clerk token for MCP", error);
      }
    };
    void syncClerkAuth();
  }, [isSignedIn, isLoading, clerkUserId, getToken, setClerkUserId, setClerkToken]);

  // Fetch setup status and leagues when signed in
  useEffect(() => {
    if (isSignedIn && !isLoading) {
      fetchSetupStatus().then(() => setSetupChecked(true));
      fetchLeagues();
    }
  }, [isSignedIn, isLoading, fetchSetupStatus, fetchLeagues]);

  // Configure MCP tools when leagues are loaded
  useEffect(() => {
    const activeLeague = getActiveLeague();
    if (activeLeague && leagues.length > 0) {
      // Update tools store with selections
      setSelectedSport(activeLeague.sport);
      setToolsPlatform('ESPN');
      setToolsAuthenticated(true);

      // Configure MCP tools
      const mcpConfig = generateMcpToolsConfig('ESPN', activeLeague.sport as any);
      if (mcpConfig) {
        setMcpConfig({
          server_label: mcpConfig.server_label,
          server_url: mcpConfig.server_url,
          allowed_tools: mcpConfig.allowed_tools.join(','),
          skip_approval: mcpConfig.require_approval === 'never'
        });
        setMcpEnabled(!mcpGloballyDisabled);
      }
    }
  }, [leagues, getActiveLeague, setMcpEnabled, setMcpConfig, setSelectedSport, setToolsPlatform, setToolsAuthenticated, mcpGloballyDisabled]);

  // Avoid hydration mismatch: wait until auth status is known or until after mount
  if (!hasMounted) {
    return <div className="h-full w-full flex items-center justify-center" />;
  }

  if (isLoading) {
    return <div className="h-full w-full flex items-center justify-center" />;
  }

  // Show sign-in prompt for unauthenticated users
  if (!isSignedIn) {
    return (
      <div className="h-full p-4 w-full bg-background flex items-center justify-center">
        <div className="max-w-md text-center space-y-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-foreground">
              Welcome to Flaim
            </h2>
            <p className="text-muted-foreground">
              Your Fantasy League AI Assistant
            </p>
          </div>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sign in to start chatting with your AI assistant and get help with your fantasy sports leagues.
            </p>

            <div className="bg-secondary border border-border rounded-lg p-4">
              <h3 className="font-medium text-secondary-foreground mb-2">Free Tier Includes:</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>100 AI messages per month</li>
                <li>Basic fantasy sports help</li>
                <li>ESPN integration</li>
              </ul>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <SignInButton mode="modal">
                <button className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium transition-colors">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="px-6 py-3 border border-primary text-primary rounded-lg hover:bg-primary/10 font-medium transition-colors">
                  Create Account
                </button>
              </SignUpButton>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Determine if setup is complete
  const isSetupComplete = setupStatus?.hasCredentials && setupStatus?.hasLeagues && setupStatus?.hasDefaultTeam;

  return (
    <div className="h-full w-full bg-background flex flex-col">
      {/* Show setup banner if setup is incomplete */}
      {setupChecked && setupStatus && !isSetupComplete && (
        <SetupBanner status={setupStatus} />
      )}

      {/* Chat interface */}
      <div className="flex-1 p-4">
        <Chat
          items={chatMessages}
          onSendMessage={handleSendMessage}
          onApprovalResponse={handleApprovalResponse}
        />
      </div>
    </div>
  );
}
