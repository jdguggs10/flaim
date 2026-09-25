#!/usr/bin/env node

/**
 * Pre-deploy probe: report which class of Supabase service key an environment
 * holds, so the signup-log webhook writer's header contract can be confirmed
 * before it ships.
 *
 * Reads SUPABASE_SERVICE_KEY from the environment and prints exactly one word:
 * `sb_secret`, `jwt`, `unrecognised`, or `missing`. It never prints, logs, or
 * returns any character of the value, and it makes no network call.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node web/scripts/probe-supabase-key-class.mjs
 *
 * The classification rules are duplicated from `classifySupabaseKey` in
 * `web/lib/server/signup-log.ts` because scripts are `.mjs` and cannot import
 * TypeScript. The two are asserted against the same fixtures in
 * `web/lib/server/__tests__/supabase-key-class-parity.test.ts`; change both
 * together.
 */

import { pathToFileURL } from "node:url";

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function classifySupabaseKey(key) {
  const value = typeof key === "string" ? key.trim() : "";
  if (!value) return "unrecognised";
  if (value.startsWith("sb_secret_")) return "sb_secret";
  if (JWT_PATTERN.test(value)) return "jwt";
  return "unrecognised";
}

export function main() {
  const raw = process.env.SUPABASE_SERVICE_KEY;
  if (!raw || !raw.trim()) {
    console.log("missing");
    return;
  }

  console.log(classifySupabaseKey(raw));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
