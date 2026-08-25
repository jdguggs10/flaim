"use client";

import Link from "next/link";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * FLA-305: Yahoo outage indicator for the homepage "Fantasy platforms" pill.
 * Yahoo cut off third-party Fantasy Sports API access in Jul 2026 and Flaim
 * has applied for restored access (tracked in FLA-237). Remove this
 * component — and render Yahoo as a plain pill again in
 * web/app/(site)/page.tsx — once FLA-237 resolves.
 */
export function YahooOutagePill() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-sm text-foreground transition-colors hover:bg-muted"
          aria-label="Yahoo: connections are temporarily unavailable, more info"
        >
          Yahoo
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-warning"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm">
        <p className="text-muted-foreground">
          Yahoo connections are temporarily unavailable while Yahoo reviews
          third-party access to its Fantasy Sports API. Flaim has applied for
          re-approval and we expect access to return soon. Existing
          connections will resume automatically.
        </p>
        <Link
          href="/support#yahoo-outage-heading"
          className="mt-2 inline-block text-primary hover:underline"
        >
          Learn more
        </Link>
      </PopoverContent>
    </Popover>
  );
}
