import { render } from "@react-email/render";
import * as React from "react";
import { describe, expect, it } from "vitest";

import {
  definePlunkBroadcast,
  plunkBroadcastSender,
  plunkUnsubscribeUrl,
} from "../../../emails/broadcast-manifest";
import KickoffBroadcastEmail from "../../../emails/broadcast-2026-08-kickoff";
import {
  preparePlunkBroadcast,
  validatePlunkBroadcastHtml,
  validatePlunkBroadcastText,
} from "../../../scripts/prepare-plunk-broadcast";

const manifest = definePlunkBroadcast({
  id: "test-kickoff",
  name: "Test kickoff",
  subject: "Draft season is here",
  preview: "A local validation fixture.",
  type: "MARKETING",
  releaseGate: {
    status: "PENDING",
    requirement: "Test release approval",
  },
  audience: {
    type: "ALL",
    description: "All subscribed contacts",
  },
  ...plunkBroadcastSender,
  ref: "email-aug-kickoff",
  expectedFlaimPaths: ["/", "/leagues"],
  template: KickoffBroadcastEmail,
});

describe("Plunk broadcast preparation", () => {
  it("renders the provider unsubscribe link only at export time", async () => {
    const previewHtml = await render(React.createElement(KickoffBroadcastEmail));
    const prepared = await preparePlunkBroadcast(manifest);

    expect(previewHtml).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    expect(previewHtml).not.toContain(plunkUnsubscribeUrl);
    expect(prepared.html).toContain(`href="${plunkUnsubscribeUrl}"`);
    expect(prepared.html).not.toContain("RESEND_UNSUBSCRIBE_URL");
    expect(prepared.text).toContain(`Unsubscribe ${plunkUnsubscribeUrl}`);
    expect(prepared.manifest).not.toHaveProperty("template");
    expect(prepared.manifest.releaseGate).toEqual({
      status: "PENDING",
      requirement: "Test release approval",
    });
  });

  it("fails closed when a Flaim link loses its campaign ref", () => {
    expect(() =>
      validatePlunkBroadcastHtml(
        [
          '<a href="https://flaim.app/?ref=email-aug-kickoff">Home</a>',
          '<a href="https://flaim.app/leagues">Manage</a>',
          `<a href="${plunkUnsubscribeUrl}">Unsubscribe</a>`,
        ].join(""),
        manifest,
      ),
    ).toThrow("missing the expected ref=email-aug-kickoff");
  });

  it("fails closed on a Resend token or a missing visible unsubscribe link", () => {
    const validLinks = [
      '<a href="https://flaim.app/?ref=email-aug-kickoff">Home</a>',
      '<a href="https://flaim.app/leagues?ref=email-aug-kickoff">Manage</a>',
    ].join("");

    expect(() =>
      validatePlunkBroadcastHtml(
        `${validLinks}<a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>`,
        manifest,
      ),
    ).toThrow("Resend unsubscribe token");

    expect(() => validatePlunkBroadcastHtml(validLinks, manifest)).toThrow(
      "visible Unsubscribe link",
    );
  });

  it("fails closed when plain text loses the unsubscribe affordance", () => {
    expect(() => validatePlunkBroadcastText("Manage your leagues")).toThrow(
      "plain-text export",
    );
  });

  it("requires HTTPS and attribution on every Flaim subdomain link", () => {
    const unsubscribeLink = `<a href="${plunkUnsubscribeUrl}">Unsubscribe</a>`;

    expect(() =>
      validatePlunkBroadcastHtml(
        [
          '<a href="https://flaim.app/?ref=email-aug-kickoff">Home</a>',
          '<a href="https://flaim.app/leagues?ref=email-aug-kickoff">Manage</a>',
          '<a href="http://docs.flaim.app/?ref=email-aug-kickoff">Docs</a>',
          unsubscribeLink,
        ].join(""),
        manifest,
      ),
    ).toThrow("must use https");
  });
});
