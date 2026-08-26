import { render } from "@react-email/render";
import * as React from "react";
import { describe, expect, it } from "vitest";
import WelcomeEmail from "@/emails/welcome";
import {
  buildAutomation,
  buildWelcomeHtml,
  buildWelcomeText,
} from "../../scripts/setup-resend-welcome-automation.mjs";

describe("Resend welcome automation setup", () => {
  it("renders the HTML and plain text from the React welcome template", async () => {
    const automationMergeProps = {
      firstName: "{{{GIVEN_NAME}}}",
      unsubscribeUrl: "{{{RESEND_UNSUBSCRIBE_URL}}}",
    };
    const [html, text, expectedHtml, expectedText] = await Promise.all([
      buildWelcomeHtml(),
      buildWelcomeText(),
      render(React.createElement(WelcomeEmail, automationMergeProps)),
      render(React.createElement(WelcomeEmail, automationMergeProps), {
        plainText: true,
      }),
    ]);

    expect(html).toBe(expectedHtml);
    expect(text).toBe(expectedText);
    expect(html).toContain("{{{GIVEN_NAME}}}");
    expect(text).toContain("{{{GIVEN_NAME}}}");
    expect(html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"');
  });

  it("always creates or updates the automation as disabled", () => {
    const automation = buildAutomation("template_123", "segment_456");

    expect(automation.status).toBe("disabled");
    expect(automation.steps).toContainEqual({
      config: { segmentId: "segment_456" },
      key: "segment",
      type: "add_to_segment",
    });
  });
});
