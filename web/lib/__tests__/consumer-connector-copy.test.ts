import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd(), "..");

const activeConsumerSurfaces = [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/CONNECTOR-DOCS.md",
  "web/app/(site)/guide/ai/page.tsx",
  "web/app/(site)/guide/page.tsx",
  "web/public/llms-full.txt",
  "workers/auth-worker/README.md",
  "workers/fantasy-mcp/README.md",
];

describe("consumer connector copy boundaries", () => {
  it("does not restore a Gemini command-line setup path", () => {
    for (const relativePath of activeConsumerSurfaces) {
      const contents = readFileSync(path.join(repoRoot, relativePath), "utf8");

      expect(contents, relativePath).not.toMatch(/Gemini CLI/i);
      expect(contents, relativePath).not.toMatch(/gemini mcp add/i);
      expect(contents, relativePath).not.toMatch(/\/mcp auth flaim/i);
    }
  });

  it("does not restore the retired Gemini CLI extension manifest", () => {
    expect(existsSync(path.join(repoRoot, "gemini-extension.json"))).toBe(false);
  });
});
