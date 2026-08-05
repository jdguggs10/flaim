import { describe, expect, it } from "vitest";

import { buildPublicDemoAnswerCacheKey } from "../public-demo-answer-cache";

describe("public demo answer cache contract", () => {
  it("reads the active v7 baseball cache keys", () => {
    expect(buildPublicDemoAnswerCacheKey("wire-watch", "baseball")).toBe(
      "public-demo-answer:wire-watch:baseball:v7:v2",
    );
  });
});
