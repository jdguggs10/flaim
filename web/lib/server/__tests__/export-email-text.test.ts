import { render } from "@react-email/render";
import * as React from "react";
import { describe, expect, it } from "vitest";

import KickoffBroadcastEmail from "../../../emails/broadcast-2026-08-kickoff";
import { htmlToText } from "../../../scripts/export-email-text.mjs";

describe("email plain-text export", () => {
  it("omits the visual linked logo header from the text fallback", () => {
    const text = htmlToText(`
      <section data-skip-in-text="true">
        <a href="https://flaim.app"><img alt="" src="https://flaim.app/mark.png"></a>
        <a href="https://flaim.app">Flaim</a>
      </section>
      <h1>Draft season is here</h1>
    `);

    expect(text).toBe("DRAFT SEASON IS HERE");
  });

  it("puts the broadcast assistant CTAs on separate text lines", async () => {
    const html = await render(React.createElement(KickoffBroadcastEmail));
    const text = htmlToText(html);

    expect(text).toContain(
      [
        "Add to ChatGPT https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36",
        "",
        "Add to Claude https://claude.ai/directory/connectors/f1a5b6a4-1f5b-470c-af23-71fc7ab13754",
      ].join("\n"),
    );
  });
});
