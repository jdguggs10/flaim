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
  parseManifestPath,
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
  it.each([
    [{ ...manifest, id: "Bad id" }, "id must be lowercase"],
    [{ ...manifest, ref: "campaign-ref" as `email-${string}` }, "ref must start with email-"],
    [{ ...manifest, subject: "" }, "name, subject, and preview are required"],
    [
      { ...manifest, releaseGate: { status: "PENDING", requirement: "" } as const },
      "must describe their release requirement",
    ],
    [
      { ...manifest, releaseGate: { status: "CLEARED", evidence: "" } as const },
      "must record release evidence",
    ],
    [{ ...manifest, expectedFlaimPaths: [] }, "at least one expected Flaim path"],
    [{ ...manifest, expectedFlaimPaths: ["leagues"] }, "must start with /"],
  ])("rejects an invalid campaign manifest", (candidate, expectedError) => {
    expect(() => definePlunkBroadcast(candidate)).toThrow(expectedError);
  });

  it("keeps CLI manifests inside the campaign directory", () => {
    expect(
      parseManifestPath(["--manifest", "emails/campaigns/flaim-3-chatgpt-launch.ts"]),
    ).toContain("/web/emails/campaigns/flaim-3-chatgpt-launch.ts");
    expect(() =>
      parseManifestPath(["--manifest", "emails/campaigns-evil/campaign.ts"]),
    ).toThrow("must live under web/emails/campaigns");
    expect(() =>
      parseManifestPath(["--manifest", "emails/campaigns/../../package.json"]),
    ).toThrow("must live under web/emails/campaigns");
  });

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

    expect(() =>
      validatePlunkBroadcastHtml(
        [
          validLinks,
          `<a href="${plunkUnsubscribeUrl}">Manage preferences</a>`,
          "<p>Read our unsubscribe policy.</p>",
          '<a href="https://example.com/help">Help</a>',
        ].join(""),
        manifest,
      ),
    ).toThrow("visible Unsubscribe link");
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
