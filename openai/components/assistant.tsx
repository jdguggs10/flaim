"use client";
import React from "react";
import { useUser, SignInButton, SignUpButton } from '@clerk/nextjs';
import Chat from "./chat";
import useConversationStore from "@/stores/useConversationStore";
import { Item, processMessages } from "@/lib/assistant";
import OnboardingFlow from "./onboarding/OnboardingFlow";
import useOnboardingStore from "@/stores/useOnboardingStore";
import useToolsStore from "@/stores/useToolsStore";
import { generateMcpToolsConfig } from "@/lib/onboarding/league-mapper";
import useHasMounted from "@/hooks/useHasMounted";

export default function Assistant() {
  // Prevent SSR–client HTML mismatch while keeping hook order intact
  const hasMounted = useHasMounted();

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
  
  // Onboarding integration
  const { 
    isComplete: onboardingComplete, 
    selectedLeague, 
    selectedPlatform,
    espnLeagues,
    activeLeagueKey,
    getActiveLeague,
    hydrateLeagues,
    completeOnboarding,
    setActiveLeague,
    step,
    setStep,
    setPlatformCredentials
  } = useOnboardingStore();
  
  const {
    setMcpEnabled,
    setMcpConfig,
    setSelectedSport,
    setSelectedPlatform: setToolsPlatform,
    setIsAuthenticated: setToolsAuthenticated
  } = useToolsStore();

  // Sync onboarding completion with tools store
  React.useEffect(() => {
    if (onboardingComplete && selectedPlatform && espnLeagues.length > 0) {
      // Get the active league (prioritize activeLeagueKey, then first league)
      const active = getActiveLeague() || espnLeagues[0];
      
      // Update tools store with onboarding selections
      setSelectedSport(active.sport);
      setToolsPlatform(selectedPlatform);
      
      // Configure ESPN authentication - credentials are now managed by auth-worker
      // Tools should fetch credentials directly from auth-worker as needed
      if (selectedPlatform === 'ESPN') {
        setToolsAuthenticated(true);
      }
      
      // Configure MCP tools
      const mcpConfig = generateMcpToolsConfig(selectedPlatform, active.sport as any);
      if (mcpConfig) {
        setMcpConfig({
          server_label: mcpConfig.server_label,
          server_url: mcpConfig.server_url,
          allowed_tools: mcpConfig.allowed_tools.join(','),
          skip_approval: mcpConfig.require_approval === 'never'
        });
        setMcpEnabled(true);
      }
    }
  }, [onboardingComplete, activeLeagueKey, selectedPlatform, espnLeagues, getActiveLeague, setMcpEnabled, setMcpConfig, setSelectedSport, setToolsPlatform, setToolsAuthenticated]);

  // Hydrate leagues once Clerk has finished loading and the user is signed in
  React.useEffect(() => {
    if (isSignedIn && !isLoading) {
      hydrateLeagues();
      // Also hydrate credential status so we can skip the ESPN auth step on new devices
      (async () => {
        try {
          const res = await fetch('/api/auth/espn/status', { cache: 'no-store' });
          if (res.ok) {
            const data = (await res.json()) as { hasCredentials?: boolean };
            if (data?.hasCredentials) {
              // Mark credentials present in the onboarding store so the UI jumps directly to league entry
              setPlatformCredentials('ESPN', { swid: 'stored', espn_s2: 'stored' });
              // If we are still at PLATFORM_AUTH step, move forward automatically
              if (useOnboardingStore.getState().step === 'PLATFORM_AUTH') {
                setStep('LEAGUE_ENTRY');
              }
            }
          }
        } catch {
          /* ignore network error */
        }
      })();
    }
  }, [isSignedIn, isLoading, hydrateLeagues, setStep, setPlatformCredentials]);

  // Automatically finish onboarding *after* the user has progressed to confirmation steps
  // This prevents an immediate auto-complete right after the user clicks the
  // Settings button (which triggers resetOnboarding) while still allowing the
  // flow to finish automatically once the user gets back to the confirmation
  // or auto-pull screens.
  React.useEffect(() => {
    const readyToComplete = ["CONFIRMATION"].includes(step);
    if (!onboardingComplete && readyToComplete && espnLeagues.some((l) => !!l.teamId)) {
      if (!activeLeagueKey) {
        setActiveLeague(espnLeagues[0]);
      }
      completeOnboarding();
    }
  }, [onboardingComplete, espnLeagues, activeLeagueKey, setActiveLeague, completeOnboarding, step]);

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
              Welcome to FLAIM
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
                <li>• 100 AI messages per month</li>
                <li>• Basic fantasy sports help</li>
                <li>• ESPN integration</li>
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

  // Show onboarding for authenticated users who haven't completed setup
  if (isSignedIn && !onboardingComplete) {
    return (
      <div className="h-full w-full bg-background">
        <OnboardingFlow />
      </div>
    );
  }

  return (
    <div className="h-full p-4 w-full bg-background">
      <Chat
        items={chatMessages}
        onSendMessage={handleSendMessage}
        onApprovalResponse={handleApprovalResponse}
      />
    </div>
  );
}
