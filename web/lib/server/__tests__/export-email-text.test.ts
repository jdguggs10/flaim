import { render } from "@react-email/render";
import * as React from "react";
import { describe, expect, it } from "vitest";

import KickoffBroadcastEmail from "../../../emails/broadcast-2026-08-kickoff";
import YahooAccessBroadcastEmail from "../../../emails/broadcast-2026-08-yahoo-access";
import { htmlToText } from "../../../scripts/export-email-text.mjs";

describe("email plain-text export", () => {
  it("omits the visual linked logo row from the text fallback", () => {
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

  it("renders the Yahoo access note without asking the recipient to retry", async () => {
    const html = await render(React.createElement(YahooAccessBroadcastEmail));
    const text = htmlToText(html);

    expect(html).toContain('src="https://flaim.app/icon-light-5kb.png"');
    expect(text).toContain("YAHOO STATUS: STILL WAITING");
    expect(text).toContain("This wait is... very frustrating.");
    expect(text).not.toContain("The moment Yahoo turns Flaim's access back on");
    expect(text).not.toContain("You will not need to reconnect or do anything else.");
    expect(text).toContain(
      "Manage ESPN & Sleeper leagues https://flaim.app/leagues?ref=email-yahoo-access-aug-2026",
    );
    expect(text).toContain("Unsubscribe {{{RESEND_UNSUBSCRIBE_URL}}}");
  });
});
