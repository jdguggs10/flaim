"use client";

import React from "react";
import { Switch, Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui";

export default function PanelConfig({
  title,
  tooltip,
  enabled,
  setEnabled,
  disabled,
  children,
  showToggle = true,
  icon,
  rightElement,
}: {
  title: string;
  tooltip: string;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
  showToggle?: boolean;
  icon?: React.ReactNode;
  rightElement?: React.ReactNode;
}) {
  const handleToggle = () => {
    setEnabled(!enabled);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          {icon && <div className="text-muted-foreground">{icon}</div>}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <h3 className="text-foreground font-medium text-sm">{title}</h3>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-sm">{tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {showToggle && (
          <Switch
            id={title}
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={disabled}
          />
        )}
        {rightElement && (
          <div>{rightElement}</div>
        )}
      </div>
      {enabled && (
        <div className="space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}
