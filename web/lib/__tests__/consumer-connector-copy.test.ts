import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(process.cwd(), "..");

// Surfaces a person or an AI client reads as Flaim's own voice. These must use
// the consumer vocabulary settled in August 2026: docs (not guide/help),
// "Yahoo sign-in" (not OAuth), ChatGPT and Claude both named as official
// channels, no Gemini, free as a present-tense fact.
const consumerSurfaces = [
  ".agents/skills/activity-brief/SKILL.md",
  ".agents/skills/analyze-matchup/SKILL.md",
  ".agents/skills/flaim-fantasy/SKILL.md",
  "README.md",
  "docs/CONNECTOR-DOCS.md",
  "web/app/(site)/about/page.tsx",
  "web/app/(site)/docs/ai/page.tsx",
  "web/app/(site)/docs/flaim/page.tsx",
  "web/app/(site)/docs/page.tsx",
  "web/app/(site)/docs/platforms/page.tsx",
  "web/app/(site)/docs/sports/page.tsx",
  "web/app/(site)/fantasy-football/page.tsx",
  "web/app/(site)/layout.tsx",
  "web/app/(site)/page.tsx",
  "web/app/(site)/support/page.tsx",
  "web/emails/espn-setup-link.tsx",
  "web/emails/flaim-email-links.json",
  "web/emails/league-connected.tsx",
  "web/emails/welcome.tsx",
  "web/lib/product-links.ts",
  "web/public/.well-known/ai-plugin.json",
  "web/public/llms.txt",
  "web/public/llms-full.txt",
  "web/scripts/setup-resend-welcome-automation.mjs",
];

// Engineering docs that still carry consumer-visible URLs and channel names
// but legitimately discuss OAuth as a protocol.
const technicalSurfaces = [
  "docs/ARCHITECTURE.md",
  "docs/CHANGELOG.md",
  "workers/auth-worker/README.md",
  "workers/fantasy-mcp/README.md",
];

const allSurfaces = [...consumerSurfaces, ...technicalSurfaces];

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("consumer connector copy boundaries", () => {
  it("does not restore a Gemini command-line setup path", () => {
    for (const relativePath of allSurfaces) {
      const contents = read(relativePath);

      expect(contents, relativePath).not.toMatch(/Gemini CLI/i);
      expect(contents, relativePath).not.toMatch(/gemini mcp add/i);
      expect(contents, relativePath).not.toMatch(/\/mcp auth flaim/i);
    }
  });

  it("does not restore the retired Gemini CLI extension manifest", () => {
    expect(existsSync(path.join(repoRoot, "gemini-extension.json"))).toBe(false);
  });

  it("uses the current ChatGPT plugin listing URL", () => {
    const retiredUrl =
      "https://chatgpt.com/apps/flaim-fantasy/asdk_app_69a8f78087e081919e52cacacf00ff36";
    const currentUrl =
      "https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36";

    for (const relativePath of allSurfaces) {
      expect(read(relativePath), relativePath).not.toContain(retiredUrl);
    }

    expect(read("web/lib/product-links.ts")).toContain(currentUrl);
  });

  it("links the docs hub at /docs, never the retired /guide routes", () => {
    for (const relativePath of allSurfaces) {
      const contents = read(relativePath);

      expect(contents, relativePath).not.toMatch(/flaim\.app\/guide\b/i);
      expect(contents, relativePath).not.toMatch(/href="\/guide\b/);
    }
  });

  it("keeps consumer surfaces on the settled vocabulary", () => {
    for (const relativePath of consumerSurfaces) {
      const contents = read(relativePath);

      // Both official channels; ChatGPT is not "the primary experience".
      expect(contents, relativePath).not.toMatch(/primary experience/i);
      // Free is a present-tense fact, never a forever promise.
      expect(contents, relativePath).not.toMatch(/free forever/i);
      // Consumer copy says "Yahoo sign-in"; OAuth stays in technical docs.
      expect(contents, relativePath).not.toMatch(
        /Yahoo via OAuth|Yahoo OAuth\b|(?:connect(?:ed)?|through) via OAuth|through OAuth/i,
      );
    }
  });

  it("names Claude wherever the welcome email names ChatGPT", () => {
    const links = JSON.parse(read("web/emails/flaim-email-links.json")) as {
      chatGptAppUrl?: string;
      claudeConnectorUrl?: string;
    };
    expect(links.chatGptAppUrl).toBeTruthy();
    expect(links.claudeConnectorUrl).toBeTruthy();

    for (const relativePath of [
      "web/emails/welcome.tsx",
      "web/scripts/setup-resend-welcome-automation.mjs",
    ]) {
      const contents = read(relativePath);
      expect(contents, relativePath).toMatch(/Add to ChatGPT/);
      expect(contents, relativePath).toMatch(/Add to Claude/);
    }
  });
});
