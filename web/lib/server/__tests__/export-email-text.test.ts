import { describe, expect, it } from "vitest";

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
});
