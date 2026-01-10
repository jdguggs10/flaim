"use client";

import { useEffect, useState } from "react";
import { User, Check, X, Loader2, RefreshCw } from "lucide-react";
import { useUser, useAuth } from "@clerk/nextjs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CopyButton } from "@/components/chat/dev-console/copy-button";

type TokenStatus = "valid" | "expired" | "checking";

export function AccountHeaderButton() {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>("checking");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const checkToken = async () => {
    try {
      const token = await getToken({ template: "cf-worker" });
      setTokenStatus(token ? "valid" : "expired");
    } catch {
      setTokenStatus("expired");
    }
  };

  useEffect(() => {
    if (!isLoaded) return;
    checkToken();
  }, [getToken, isLoaded]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTokenStatus("checking");
    await checkToken();
    setIsRefreshing(false);
  };

  const statusColor = tokenStatus === "valid"
    ? "bg-green-500"
    : tokenStatus === "expired"
      ? "bg-red-500"
      : "bg-muted-foreground";

  const statusLabel = tokenStatus === "valid"
    ? "Token valid"
    : tokenStatus === "expired"
      ? "Token expired"
      : "Checking token";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary transition-colors text-sm"
          aria-label="Account status"
        >
          <User className="h-4 w-4" />
          <span className="hidden sm:inline text-xs font-medium">Account</span>
          <span className={`h-2 w-2 rounded-full ${statusColor}`} title={statusLabel} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        {!isLoaded ? (
          <div className="text-xs text-muted-foreground">Loading account…</div>
        ) : !user ? (
          <div className="text-xs text-muted-foreground">Not signed in.</div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs">
              <span className="text-muted-foreground">Email: </span>
              <span className="font-mono">
                {user.primaryEmailAddress?.emailAddress || "N/A"}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">ID: </span>
              <span className="font-mono">{user.id.slice(0, 12)}…</span>
              <CopyButton value={user.id} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Token:</span>
                {tokenStatus === "checking" ? (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    checking
                  </span>
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
        )}
      </PopoverContent>
    </Popover>
  );
}
