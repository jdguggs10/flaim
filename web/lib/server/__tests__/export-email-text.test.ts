import { render } from "@react-email/render";
import * as React from "react";
import { describe, expect, it } from "vitest";

import KickoffBroadcastEmail from "../../../emails/broadcast-2026-08-kickoff";
import YahooAccessBroadcastEmail from "../../../emails/broadcast-2026-08-yahoo-access";
import SeptemberUpdateBroadcastEmail from "../../../emails/broadcast-2026-09-update";
import YahooBackBroadcastEmail from "../../../emails/broadcast-2026-09-yahoo-back";
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

    expect(text).toContain("PRODUCT UPDATES");
    expect(text).toContain(
      [
        "Add to ChatGPT https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36",
        "",
        "Add to Claude https://claude.ai/directory/connectors/f1a5b6a4-1f5b-470c-af23-71fc7ab13754",
      ].join("\n"),
    );
  });

  it("renders the Yahoo status note with the managed-leagues CTA", async () => {
    const html = await render(React.createElement(YahooAccessBroadcastEmail));
    const text = htmlToText(html);

    expect(html).toContain('src="https://flaim.app/icon-light-5kb.png"');
    expect(html).toContain('alt="Flaim"');
    expect(text).not.toContain("https://flaim.app/icon-light-5kb.png");
    expect(text).not.toContain(
      "https://flaim.app/?ref=email-yahoo-access-aug-2026",
    );
    expect(html).toContain("Yahoo Update");
    expect(html.indexOf("Yahoo Update")).toBeLessThan(
      html.indexOf('src="https://flaim.app/icon-light-5kb.png"'),
    );
    expect(text).toContain("YAHOO UPDATE");
    expect(html).not.toContain("Yahoo Status: Still Waiting");
    expect(text).not.toContain("YAHOO STATUS: STILL WAITING");
    expect(text).toContain("This wait is... very frustrating.");
    expect(text).not.toContain("The moment Yahoo turns Flaim's access back on");
    expect(text).not.toContain("You will not need to reconnect or do anything else.");
    expect(text).toContain(
      "Manage ESPN & Sleeper leagues https://flaim.app/leagues?ref=email-yahoo-access-aug-2026",
    );
    expect(text).toContain("Unsubscribe {{{RESEND_UNSUBSCRIBE_URL}}}");
  });

  it("renders the September product update copy and attributed docs link", async () => {
    const html = await render(React.createElement(SeptemberUpdateBroadcastEmail));
    const text = htmlToText(html);

    expect(text).toContain(
      "Draft results are here! See your actual ESPN and Sleeper picks, draft positions, and auction costs where available.",
    );
    expect(text).toContain(
      "More ESPN history and detail. Explore pre-2018 seasons where available, plus starters, bench players, and points for football matchups from 2018 onward.",
    );
    expect(text).toContain(
      "More ways to use Flaim. In addition to official ChatGPT and Claude support, Perplexity, Grok, and Gemini are also available as custom connectors.",
    );
    expect(text).toContain("Yahoo is back!");
    expect(html).toContain(
      'href="https://flaim.app/docs/ai?ref=email-sep-2026-update"',
    );
  });

  it("renders the Yahoo restoration broadcast with its GIF and footer disclosure", async () => {
    const html = await render(React.createElement(YahooBackBroadcastEmail));
    const text = htmlToText(html);

    expect(text).toContain("YAHOO IS BACK");
    expect(text).toContain(
      "You are receiving this because Yahoo is connected to your Flaim account.",
    );
    expect(html).toContain(
      'src="https://media1.tenor.com/m/GMQO9zwZ_QgAAAAd/slow-clap-gardner.gif"',
    );
    expect(text).toContain("Unsubscribe {{{RESEND_UNSUBSCRIBE_URL}}}");
  });
});
