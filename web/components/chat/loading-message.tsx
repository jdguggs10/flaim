"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import useConversationStore from "@/stores/chat/useConversationStore";

const LoadingMessage: React.FC = () => {
  const { loadingState } = useConversationStore();
  const [expanded, setExpanded] = useState(false);

  // Only render during connecting or thinking states
  if (loadingState.status !== "connecting" && loadingState.status !== "thinking") {
    return null;
  }

  const hasThinkingText = loadingState.thinkingText.length > 0;
  const label = loadingState.status === "connecting" ? "Connecting..." : "Thinking...";

  return (
    <div className="text-sm">
      <div className="flex flex-col">
        <div className="flex">
          <div className="mr-4 rounded-[16px] px-4 py-2 md:mr-24 text-foreground bg-card font-light">
            {/* Pill header: spinner + label + optional expand toggle */}
            <button
              type="button"
              onClick={() => hasThinkingText && setExpanded(!expanded)}
              disabled={!hasThinkingText}
              className="flex items-center gap-2 disabled:cursor-default"
            >
              {/* Spinner */}
              <div className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />

              <span className="text-sm text-muted-foreground">{label}</span>

              {/* Expand chevron (only when there's thinking text) */}
              {hasThinkingText && (
                <span className="text-muted-foreground">
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              )}
            </button>

            {/* Expanded thinking text */}
            {expanded && hasThinkingText && (
              <div className="mt-2 pt-2 border-t border-border max-h-40 overflow-y-auto">
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {loadingState.thinkingText}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoadingMessage;
