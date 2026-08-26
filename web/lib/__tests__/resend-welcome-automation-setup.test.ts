import { render } from "@react-email/render";
import * as React from "react";
import { describe, expect, it } from "vitest";
import WelcomeEmail from "@/emails/welcome";
import {
  buildAutomation,
  buildWelcomeHtml,
  buildWelcomeText,
  buildWelcomeTemplate,
} from "../../scripts/setup-resend-welcome-automation.mjs";

describe("Resend welcome automation setup", () => {
  it("renders the HTML and plain text from the React welcome template", async () => {
    const automationMergeProps = {
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
    expect(html).toContain("Hi there,");
    expect(text).toContain("Hi there,");
    expect(html).not.toContain("GIVEN_NAME");
    expect(text).not.toContain("GIVEN_NAME");
    expect(html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"');
  });

  it("clears template variables when updating the existing welcome template", async () => {
    const template = await buildWelcomeTemplate();

    expect(template.variables).toEqual([]);
  });

  it("always creates or updates the automation as disabled", () => {
    const automation = buildAutomation("template_123", "segment_456");

    expect(automation.status).toBe("disabled");
    expect(automation.steps).toContainEqual({
      config: { segmentId: "segment_456" },
      key: "segment",
      type: "add_to_segment",
    });
    expect(automation.steps).toContainEqual({
      config: {
        from: "Flaim <updates@flaim.app>",
        replyTo: "support@flaim.app",
        subject: "Welcome to Flaim",
        template: { id: "template_123" },
      },
      key: "welcome",
      type: "send_email",
    });
    const welcomeStep = automation.steps.find((step) => step.key === "welcome");
    expect(welcomeStep?.config.template).not.toHaveProperty("variables");
  });
});
