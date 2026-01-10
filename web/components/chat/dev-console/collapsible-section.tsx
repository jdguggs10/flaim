"use client";

import { useState, ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
  rightElement?: ReactNode;
}

export function CollapsibleSection({
  title,
  icon,
  defaultExpanded = false,
  children,
  rightElement,
}: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden shrink-0">
      {/* Header - split into clickable area and rightElement to avoid nested buttons */}
      <div className="flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors">
        {/* Clickable area for expand/collapse */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          {icon && <div className="text-muted-foreground">{icon}</div>}
          <span className="text-sm font-medium text-foreground">{title}</span>
        </button>

        {/* Right side: rightElement (may contain buttons) + chevron */}
        <div className="flex items-center gap-2">
          {rightElement}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border pt-3">
          {children}
        </div>
      )}
    </div>
  );
}
