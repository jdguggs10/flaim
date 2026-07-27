"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import {
  clearBrowserFirstTouch,
  getOrCaptureBrowserFirstTouch,
} from "@/lib/acquisition";

/**
 * Records a privacy-bounded first touch before a visitor reaches Clerk.
 * The auth components read the same write-once cookie when a signup begins.
 */
export function AcquisitionFirstTouch() {
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    getOrCaptureBrowserFirstTouch();
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) clearBrowserFirstTouch();
  }, [isLoaded, isSignedIn]);

  return null;
}
