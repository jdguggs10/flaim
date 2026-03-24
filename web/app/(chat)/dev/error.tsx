"use client";

import { useEffect } from "react";

export default function DevError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dev chat error boundary:", error);
  }, [error]);

  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="text-center space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          The dev chat encountered an error. Try refreshing.
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
