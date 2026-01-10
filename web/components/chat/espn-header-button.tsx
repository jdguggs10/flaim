"use client";

import { useEffect, useState } from "react";
import { Link2, Check, X, RefreshCw, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

type CredentialStatus = "checking" | "valid" | "missing" | "error";

interface EspnStatusResponse {
  hasCredentials: boolean;
  hasLeagues: boolean;
  hasDefaultTeam: boolean;
}

export function EspnHeaderButton() {
  const [status, setStatus] = useState<CredentialStatus>("checking");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const checkCredentials = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/auth/espn/status", { cache: "no-store" });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = await res.json() as EspnStatusResponse;
      setStatus(data.hasCredentials ? "valid" : "missing");
    } catch {
      setStatus("error");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    checkCredentials();
  }, []);

  const statusColor = status === "valid"
    ? "bg-green-500"
    : status === "missing"
      ? "bg-red-500"
      : status === "error"
        ? "bg-amber-500"
        : "bg-muted-foreground";

  const statusLabel = status === "valid"
    ? "Stored"
    : status === "missing"
      ? "Not configured"
      : status === "error"
        ? "Check failed"
        : "Checking";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary transition-colors text-sm"
          aria-label="ESPN connection status"
        >
          <Link2 className="h-4 w-4" />
          <span className="hidden sm:inline text-xs font-medium">ESPN</span>
          <span className={`h-2 w-2 rounded-full ${statusColor}`} title={statusLabel} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Credentials:</span>
            <div className="flex items-center gap-2">
              {status === "checking" ? (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking
                </span>
              ) : status === "valid" ? (
                <span className="flex items-center gap-1 text-green-600">
                  <Check className="h-3 w-3" />
                  Stored
                </span>
              ) : status === "missing" ? (
                <span className="flex items-center gap-1 text-red-600">
                  <X className="h-3 w-3" />
                  Not configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-600">
                  <X className="h-3 w-3" />
                  Check failed
                </span>
              )}
              <button
                onClick={checkCredentials}
                disabled={isRefreshing}
                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                title="Refresh status"
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {status === "missing" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                No ESPN credentials found. Use the Chrome extension or manual setup.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                asChild
              >
                <a href="/extension" target="_blank" rel="noopener noreferrer">
                  Set up ESPN connection
                </a>
              </Button>
            </div>
          )}

          {status === "error" && (
            <p className="text-xs text-amber-600">
              Could not verify credential status. Try refreshing.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
