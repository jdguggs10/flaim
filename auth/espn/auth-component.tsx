"use client";

import React, { useState, useEffect } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, AlertCircle, Loader2, Eye, EyeOff } from "lucide-react";
import useToolsStore from "@/stores/useToolsStore";

export default function EspnAuth() {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const {
    userEmail,
    setUserEmail,
    espnS2,
    setEspnS2,
    espnSWID,
    setEspnSWID,
    isAuthenticated,
    setIsAuthenticated,
    setMcpConfig,
    setMcpEnabled,
  } = useToolsStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showS2, setShowS2] = useState(false);
  const [showSWID, setShowSWID] = useState(false);
  const [toast, setToast] = useState<{type: 'error' | 'success' | 'warning', message: string} | null>(null);
  const [discoveredLeagues, setDiscoveredLeagues] = useState<any[]>([]);

  // Check if we have complete credentials
  const hasCompleteCredentials = espnS2 && espnSWID;
  const clerkUserId = user?.id;
  
  // MCP service base URL - configurable via environment variable
  const mcpBaseUrl = process.env.NEXT_PUBLIC_MCP_BASE_URL || 'https://baseball-espn-mcp.your-domain.workers.dev';

  // Toast notification helper
  const showToast = (type: 'error' | 'success' | 'warning', message: string) => {
    setToast({ type, message });
    // Auto-dismiss after 5 seconds
    setTimeout(() => setToast(null), 5000);
  };

  // Set user email from Clerk
  useEffect(() => {
    if (user?.emailAddresses?.[0]?.emailAddress && !userEmail) {
      setUserEmail(user.emailAddresses[0].emailAddress);
    }
  }, [user, userEmail, setUserEmail]);

  // Check existing credentials on mount
  useEffect(() => {
    if (clerkUserId && isLoaded && !isAuthenticated) {
      checkExistingCredentials();
    }
  }, [clerkUserId, isLoaded]);

  const checkExistingCredentials = async () => {
    if (!clerkUserId) return;

    try {
      setLoading(true);
      setError(""); // Clear any previous errors
      
      // Get session token for authentication
      const token = await getToken();
      
      const response = await fetch(`${mcpBaseUrl}/credential/espn`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
      });

      const data = await response.json() as { hasCredentials?: boolean; error?: string };
      
      if (response.ok && data.hasCredentials) {
        setIsAuthenticated(true);
        
        // Auto-configure MCP for existing valid credentials
        setMcpConfig({
          server_label: "fantasy-baseball",
          server_url: `${mcpBaseUrl}/mcp`,
          allowed_tools: "get_espn_league_info,get_espn_team_roster,get_espn_matchups",
          skip_approval: true,
        });
        setMcpEnabled(true);
        setSuccess("ESPN credentials found and validated!");
      } else if (response.status === 401) {
        // Authentication error
        setError("Session expired. Please refresh the page and sign in again.");
      } else if (response.status >= 500) {
        // Server error
        setError("ESPN service temporarily unavailable. Please try again later.");
      } else if (!data.hasCredentials) {
        // No credentials stored - this is normal for new users
        console.log("No ESPN credentials found for user");
      } else {
        // Other client errors
        setError(data.error || "Failed to check ESPN credentials. Please try again.");
      }
    } catch (err) {
      console.error("Failed to check existing credentials:", err);
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  // Save ESPN credentials to server
  const saveEspnCredentials = async () => {
    if (!hasCompleteCredentials) {
      setError("Please fill in both ESPN S2 and SWID fields");
      return;
    }

    if (!clerkUserId) {
      setError("Please sign in with Clerk first");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      // Get session token for authentication
      const token = await getToken();
      
      const response = await fetch(`${mcpBaseUrl}/credential/espn`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          swid: espnSWID,
          espn_s2: espnS2,
          email: userEmail
        }),
      });

      const data = await response.json() as { success?: boolean; error?: string | { message?: string } };

      if (response.ok && data.success) {
        setIsAuthenticated(true);
        setSuccess("ESPN credentials saved successfully!");
        
        // Auto-discover leagues after successful authentication
        await discoverUserLeagues();
        
        // Auto-configure MCP with Clerk-based auth
        setMcpConfig({
          server_label: "fantasy-baseball",
          server_url: `${mcpBaseUrl}/mcp`,
          allowed_tools: "get_espn_league_info,get_espn_team_roster,get_espn_matchups",
          skip_approval: true,
        });
        setMcpEnabled(true);
      } else if (response.status === 401) {
        setError("Session expired. Please refresh the page and sign in again.");
      } else if (response.status === 403) {
        setError("Access denied. Please check your ESPN credentials are valid.");
      } else if (response.status >= 500) {
        setError("ESPN service temporarily unavailable. Please try again later.");
      } else if (response.status === 400) {
        // Bad request - usually invalid credentials format
        const errMsg = typeof data.error === "string" 
          ? data.error 
          : (typeof data.error === "object" && data.error?.message) || "Invalid ESPN credentials format. Please check your S2 and SWID values.";
        setError(errMsg);
      } else {
        // Generic error with fallback message
        const errMsg = typeof data.error === "string" 
          ? data.error 
          : (typeof data.error === "object" && data.error?.message) || `Failed to save credentials (${response.status})`;
        setError(errMsg);
      }
    } catch (err) {
      console.error("Save credentials error:", err);
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError("Cannot connect to ESPN service. Please check your internet connection.");
      } else {
        setError("Network error. Please try again in a few moments.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Discover user's fantasy leagues after successful authentication
  const discoverUserLeagues = async () => {
    if (!clerkUserId) return;

    try {
      console.log('🔍 Discovering leagues for user after ESPN authentication...');
      
      // Get session token for authentication
      const token = await getToken();
      
      const response = await fetch(`${mcpBaseUrl}/discover-leagues`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
      });

      const result = await response.json() as { 
        success?: boolean; 
        data?: { 
          allLeagues?: any[]; 
          totalLeagues?: number; 
          baseballLeagues?: any[]; 
          footballLeagues?: any[]; 
        }; 
        error?: string; 
      };

      if (response.ok && result.success) {
        setDiscoveredLeagues(result.data?.allLeagues || []);
        
        const totalLeagues = result.data?.totalLeagues || 0;
        const baseballCount = result.data?.baseballLeagues?.length || 0;
        const footballCount = result.data?.footballLeagues?.length || 0;
        
        if (totalLeagues > 0) {
          const sportBreakdown = [];
          if (baseballCount > 0) sportBreakdown.push(`${baseballCount} baseball`);
          if (footballCount > 0) sportBreakdown.push(`${footballCount} football`);
          
          const discoveryMessage = `🎉 Discovered ${totalLeagues} league${totalLeagues > 1 ? 's' : ''}: ${sportBreakdown.join(' and ')}.`;
          setSuccess(discoveryMessage);
          
          console.log('League discovery successful:', result.data);
        } else {
          setSuccess("ESPN credentials saved! No active leagues found - you can manually enter league IDs.");
        }
      } else {
        // Discovery failed, but auth was successful
        console.warn('League discovery failed:', result.error);
        setSuccess("ESPN credentials saved! Auto-discovery failed - you can manually enter league IDs.");
      }
    } catch (error) {
      console.error('League discovery error:', error);
      // Don't show error to user since auth was successful
      setSuccess("ESPN credentials saved! Auto-discovery unavailable - you can manually enter league IDs.");
    }
  };

  const deleteEspnCredentials = async () => {
    if (!clerkUserId) {
      setError("Please sign in with Clerk first");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      // Get session token for authentication
      const token = await getToken();
      
      const response = await fetch(`${mcpBaseUrl}/credential/espn`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
      });

      const data = await response.json() as { success?: boolean; error?: string | { message?: string } };

      if (response.ok && data.success) {
        setIsAuthenticated(false);
        setEspnS2("");
        setEspnSWID("");
        setDiscoveredLeagues([]);
        setMcpEnabled(false);
        setSuccess("ESPN credentials deleted successfully!");
      } else if (response.status === 401) {
        setError("Session expired. Please refresh the page and sign in again.");
      } else if (response.status >= 500) {
        setError("ESPN service temporarily unavailable. Please try again later.");
      } else {
        const errMsg = typeof data.error === "string" 
          ? data.error 
          : (typeof data.error === "object" && data.error?.message) || `Failed to delete credentials (${response.status})`;
        setError(errMsg);
      }
    } catch (err) {
      console.error("Delete credentials error:", err);
      if (err instanceof TypeError && err.message.includes('fetch')) {
        setError("Cannot connect to ESPN service. Please check your internet connection.");
      } else {
        setError("Network error. Please try again in a few moments.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center p-6 border border-gray-200 rounded-lg">
        <h3 className="text-lg font-semibold mb-2">🔐 Sign In Required</h3>
        <p className="text-gray-600 mb-4">
          Please sign in with Clerk to manage your ESPN credentials.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* User Info */}
      <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
        <CheckCircle size={16} />
        Signed in as {user.emailAddresses?.[0]?.emailAddress || user.firstName || 'User'}
      </div>

      {/* ESPN Credentials Form */}
      {!isAuthenticated && (
        <div className="space-y-4 p-4 border border-gray-200 rounded-lg">
          <h4 className="font-semibold">ESPN Fantasy Sports Credentials</h4>
          
          <div className="space-y-2">
            <Label htmlFor="espnS2">ESPN S2 Cookie</Label>
            <div className="relative">
              <Input
                id="espnS2"
                type={showS2 ? "text" : "password"}
                placeholder="Enter your ESPN S2 value"
                value={espnS2}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEspnS2(e.target.value)}
                disabled={loading}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setShowS2(!showS2)}
              >
                {showS2 ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="espnSWID">ESPN SWID Cookie</Label>
            <div className="relative">
              <Input
                id="espnSWID"
                type={showSWID ? "text" : "password"}
                placeholder="Enter your ESPN SWID value"
                value={espnSWID}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEspnSWID(e.target.value)}
                disabled={loading}
                className="pr-10"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setShowSWID(!showSWID)}
              >
                {showSWID ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <Button 
            onClick={saveEspnCredentials}
            disabled={loading || !hasCompleteCredentials}
            className="w-full"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? "Saving..." : "Save ESPN Credentials"}
          </Button>
        </div>
      )}

      {/* Authenticated State */}
      {isAuthenticated && (
        <div className="space-y-4 p-4 border border-green-200 bg-green-50 rounded-lg">
          <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
            <CheckCircle size={16} />
            ESPN Integration Active ✓
          </div>
          
          <p className="text-sm text-gray-600">
            Your ESPN credentials are securely stored and encrypted. You can now access private league data.
          </p>

          {/* Discovered Leagues */}
          {discoveredLeagues.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-gray-700">Discovered Leagues:</h4>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {discoveredLeagues.map((league, index) => (
                  <div key={index} className="text-xs bg-white p-2 rounded border">
                    <div className="font-medium text-gray-800">{league.leagueName}</div>
                    <div className="text-gray-600">
                      {league.sport.toUpperCase()} • League ID: {league.leagueId} • Team: {league.teamName}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <Button 
            onClick={deleteEspnCredentials}
            disabled={loading}
            variant="destructive"
            size="sm"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? "Deleting..." : "Delete ESPN Credentials"}
          </Button>
        </div>
      )}

      {/* Toast Notifications */}
      {toast && (
        <div className={`flex items-center gap-2 text-sm p-3 rounded-lg border ${
          toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
          toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
          'bg-yellow-50 border-yellow-200 text-yellow-700'
        }`}>
          {toast.type === 'error' && <AlertCircle size={16} />}
          {toast.type === 'success' && <CheckCircle size={16} />}
          {toast.type === 'warning' && <AlertCircle size={16} />}
          <span>{toast.message}</span>
          <button 
            onClick={() => setToast(null)}
            className="ml-auto text-current hover:opacity-70"
          >
            ×
          </button>
        </div>
      )}

      {/* Legacy Status Messages (keeping for compatibility) */}
      {error && !toast && (
        <div className="flex items-center gap-2 text-red-600 text-sm">
          <AlertCircle size={16} />
          {typeof error === "string" ? error : (error as any).message || JSON.stringify(error)}
        </div>
      )}

      {success && !toast && (
        <div className="flex items-center gap-2 text-green-600 text-sm">
          <CheckCircle size={16} />
          {success}
        </div>
      )}

      {/* Help Text */}
      <div className="text-xs text-gray-500 space-y-1">
        <p><strong>How to get your ESPN cookies:</strong></p>
        <ol className="list-decimal list-inside space-y-1 ml-2">
          <li>Go to <a href="https://fantasy.espn.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">fantasy.espn.com</a> and sign in</li>
          <li>Open browser Developer Tools (F12)</li>
          <li>Go to Application tab → Cookies → fantasy.espn.com</li>
          <li>Copy the values for "espn_s2" and "SWID"</li>
          <li>Paste them into the fields above</li>
        </ol>
        <p className="mt-2">• Your credentials are encrypted and stored per user</p>
        <p>• Only you can access your private league data</p>
        <p>• Delete anytime to revoke access</p>
      </div>
    </div>
  );
}