"use client";

import { useEffect } from "react";
import { getOrCaptureBrowserFirstTouch } from "@/lib/acquisition";

/**
 * Records a privacy-bounded first touch before a visitor reaches Clerk.
 * The auth components read the same write-once cookie when a signup begins.
 */
export function AcquisitionFirstTouch() {
  useEffect(() => {
    getOrCaptureBrowserFirstTouch();
  }, []);

  return null;
}
