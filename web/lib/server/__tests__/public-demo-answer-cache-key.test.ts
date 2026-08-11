import { describe, expect, it } from "vitest";

import {
  buildPublicDemoAnswerCacheKey,
  buildPublicDemoTargetAnswerCacheKey,
} from "../public-demo-answer-cache";

describe("public demo answer cache contract", () => {
  it("reads the active v7 baseball cache keys", () => {
    expect(buildPublicDemoAnswerCacheKey("wire-watch", "baseball")).toBe(
      "public-demo-answer:wire-watch:baseball:v7:v2",
    );
  });

  it("builds the six-segment v8 platform-aware target cache keys", () => {
    expect(
      buildPublicDemoTargetAnswerCacheKey("wire-watch", "sleeper", "football"),
    ).toBe("public-demo-answer:wire-watch:sleeper:football:v8:v3");
  });
});
