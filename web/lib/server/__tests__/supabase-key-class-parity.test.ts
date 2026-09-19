import { describe, expect, it } from "vitest";

import { classifySupabaseKey } from "../signup-log";
import { classifySupabaseKey as classifyInScript } from "../../../scripts/probe-supabase-key-class.mjs";

/**
 * `classifySupabaseKey` is deliberately duplicated: once in TypeScript for the
 * webhook writer, once inlined in the `.mjs` pre-deploy probe, which cannot
 * import TypeScript. These fixtures are the contract that keeps them identical.
 */
const FIXTURES = [
  "sb_secret_abcdef123456",
  "sb_secret_",
  "sb_publishable_abcdef",
  "aaaa.bbbb.cccc",
  "eyJh-bG_ciOi.eyJpc3MiOiJz.dGVzdC1zaWc",
  "aaaa.bbbb",
  "aaaa.bbbb.cccc.dddd",
  "aaaa.bbbb.cc cc",
  "legacy-opaque-key",
  "  sb_secret_padded  ",
  "   ",
  "",
];

describe("Supabase key classification parity", () => {
  it.each(FIXTURES)("agrees between the module and the probe script for %j", (key) => {
    expect(classifyInScript(key)).toBe(classifySupabaseKey(key));
  });

  it("never returns any part of the key", () => {
    for (const key of FIXTURES) {
      expect(["sb_secret", "jwt", "unrecognised"]).toContain(classifySupabaseKey(key));
    }
  });
});
