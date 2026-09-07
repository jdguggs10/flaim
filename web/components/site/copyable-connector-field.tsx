"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type CopyableConnectorFieldProps = {
  label: string;
  value: string;
};

export function CopyableConnectorField({
  label,
  value,
}: CopyableConnectorFieldProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="min-w-0 rounded-lg border bg-background p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
            {label}
          </p>
          <code className="mt-1 block break-all select-text text-sm text-muted-foreground">
            {value}
          </code>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full shrink-0 sm:w-auto"
          onClick={copyValue}
          aria-label={status === "copied" ? `${label} copied` : `Copy ${label}`}
        >
          {status === "copied" ? (
            <>
              Copied
              <Check className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
            </>
          ) : (
            <>
              Copy
              <Copy className="ml-2 h-3.5 w-3.5" aria-hidden="true" />
            </>
          )}
        </Button>
        <span className="sr-only" aria-live="polite">
          {status === "copied" ? `${label} copied.` : ""}
        </span>
      </div>
      {status === "failed" && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          Copy failed. Select the text above and copy it manually.
        </p>
      )}
    </div>
  );
}
