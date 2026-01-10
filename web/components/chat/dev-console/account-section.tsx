"use client";

import { useEffect, useState } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { User, Check, X, RefreshCw } from "lucide-react";
import { CollapsibleSection } from "./collapsible-section";
import { CopyButton } from "./copy-button";

export function AccountSection() {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [tokenStatus, setTokenStatus] = useState<"valid" | "expired" | "checking">("checking");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Check token status on mount
  useEffect(() => {
    const check = async () => {
      try {
        const token = await getToken({ template: "cf-worker" });
        setTokenStatus(token ? "valid" : "expired");
      } catch {
        setTokenStatus("expired");
      }
    };
    check();
  }, [getToken]);

  const checkToken = async () => {
    setTokenStatus("checking");
    try {
      const token = await getToken({ template: "cf-worker" });
      setTokenStatus(token ? "valid" : "expired");
    } catch {
      setTokenStatus("expired");
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await checkToken();
    setIsRefreshing(false);
  };

  if (!isLoaded) {
    return (
      <CollapsibleSection title="Account" icon={<User size={16} />} defaultExpanded={false}>
        <div className="text-xs text-muted-foreground">Loading...</div>
      </CollapsibleSection>
    );
  }

  if (!user) {
    return (
      <CollapsibleSection title="Account" icon={<User size={16} />} defaultExpanded={false}>
        <div className="text-xs text-muted-foreground">Not signed in</div>
      </CollapsibleSection>
    );
  }

  const truncatedId = user.id.slice(0, 12) + "...";

  return (
    <CollapsibleSection title="Account" icon={<User size={16} />} defaultExpanded={false}>
      <div className="space-y-2">
        {/* Email */}
        <div className="text-xs">
          <span className="text-muted-foreground">Email: </span>
          <span className="font-mono">{user.primaryEmailAddress?.emailAddress || "N/A"}</span>
        </div>

        {/* User ID */}
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">ID: </span>
          <span className="font-mono">{truncatedId}</span>
          <CopyButton value={user.id} />
        </div>

        {/* Token status */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Token: </span>
            {tokenStatus === "checking" ? (
              <span className="text-muted-foreground">checking...</span>
            ) : tokenStatus === "valid" ? (
              <span className="flex items-center gap-1 text-green-600">
                <Check className="h-3 w-3" />
                valid
              </span>
            ) : (
              <span className="flex items-center gap-1 text-red-600">
                <X className="h-3 w-3" />
                expired
              </span>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh token"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
    </CollapsibleSection>
  );
}
