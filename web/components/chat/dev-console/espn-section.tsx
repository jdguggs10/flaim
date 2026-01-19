"use client";

import { useState, useEffect } from "react";
import { Link2, Check, X, Loader2, RefreshCw } from "lucide-react";
import { CollapsibleSection } from "./collapsible-section";
import { Button } from "@/components/ui/button";

type CredentialStatus = "checking" | "valid" | "missing" | "error";

interface EspnStatusResponse {
  hasCredentials: boolean;
  hasLeagues: boolean;
  hasDefaultTeam: boolean;
}

export function EspnSection() {
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

  // Check on mount
  useEffect(() => {
    checkCredentials();
  }, []);

  const StatusBadge = () => {
    switch (status) {
      case "checking":
        return (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking...
          </span>
        );
      case "valid":
        return (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3 w-3" />
            Stored
          </span>
        );
      case "missing":
        return (
          <span className="flex items-center gap-1 text-xs text-red-600">
            <X className="h-3 w-3" />
            Not configured
          </span>
        );
      case "error":
        return (
          <span className="flex items-center gap-1 text-xs text-amber-600">
            <X className="h-3 w-3" />
            Check failed
          </span>
        );
    }
  };

  return (
    <CollapsibleSection
      title="ESPN Connection"
      icon={<Link2 size={16} />}
      defaultExpanded={false}
    >
      <div className="space-y-3">
        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Credentials:</span>
          <div className="flex items-center gap-2">
            <StatusBadge />
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

        {/* Info text based on status */}
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
              <a href="/" target="_blank" rel="noopener noreferrer">
                Open ESPN setup
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
    </CollapsibleSection>
  );
}
