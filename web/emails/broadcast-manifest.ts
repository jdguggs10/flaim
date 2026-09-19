import * as React from "react";

/**
 * A provider-neutral preview value. Broadcast exports replace it with the
 * provider's recipient-specific URL before a draft is ever created.
 */
export const previewUnsubscribeUrl = "https://unsubscribe.invalid/";

/**
 * Plunk resolves this value separately for every recipient. It is intentionally
 * kept out of template preview props so it cannot become a source-template
 * dependency.
 */
export const plunkUnsubscribeUrl = "{{unsubscribeUrl}}";

export const plunkBroadcastSender = {
  from: "updates@news.flaim.app",
  fromName: "Gerry",
  replyTo: "gerry@news.flaim.app",
} as const;

export type BroadcastTemplateProps = {
  unsubscribeUrl?: string;
};

type BroadcastAudience =
  | {
      type: "ALL";
      description: string;
    }
  | {
      type: "SEGMENT";
      description: string;
      segmentName: string;
    };

export type BroadcastReleaseGate =
  | {
      /** External event that must happen before a provider draft or proof. */
      requirement: string;
      status: "PENDING";
    }
  | {
      /** Record the observed evidence that cleared the external release gate. */
      evidence: string;
      status: "CLEARED";
    };

export type PlunkBroadcastManifest = {
  /** A stable local identifier, used only for the exported file names. */
  id: string;
  /** Human-readable campaign label for the Plunk draft. */
  name: string;
  subject: string;
  preview: string;
  /** MARKETING respects opt-outs and uses Plunk's marketing safeguards. */
  type: "MARKETING";
  /** A provider draft and proof require an approved, evidenced release gate. */
  releaseGate: BroadcastReleaseGate;
  audience: BroadcastAudience;
  from: typeof plunkBroadcastSender.from;
  fromName: typeof plunkBroadcastSender.fromName;
  replyTo: typeof plunkBroadcastSender.replyTo;
  /** The exact first-party attribution value required on every Flaim URL. */
  ref: `email-${string}`;
  /** Required Flaim paths make an accidentally removed CTA fail validation. */
  expectedFlaimPaths: readonly string[];
  template: React.ComponentType<BroadcastTemplateProps>;
};

const localIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const emailRefPattern = /^email-[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Keeps campaign metadata, sender identity, and its React Email source in one
 * typed object. This intentionally has no provider API dependency.
 */
export function definePlunkBroadcast(
  manifest: PlunkBroadcastManifest,
): PlunkBroadcastManifest {
  if (!localIdPattern.test(manifest.id)) {
    throw new Error("Plunk broadcast id must be lowercase letters, digits, and hyphens");
  }

  if (!emailRefPattern.test(manifest.ref)) {
    throw new Error("Plunk broadcast ref must start with email-");
  }

  if (!manifest.subject.trim() || !manifest.preview.trim() || !manifest.name.trim()) {
    throw new Error("Plunk broadcast name, subject, and preview are required");
  }

  if (
    manifest.releaseGate.status === "PENDING" &&
    !manifest.releaseGate.requirement.trim()
  ) {
    throw new Error("Pending Plunk broadcasts must describe their release requirement");
  }

  if (
    manifest.releaseGate.status === "CLEARED" &&
    !manifest.releaseGate.evidence.trim()
  ) {
    throw new Error("Cleared Plunk broadcasts must record release evidence");
  }

  if (manifest.expectedFlaimPaths.length === 0) {
    throw new Error("Plunk broadcasts must declare at least one expected Flaim path");
  }

  for (const expectedPath of manifest.expectedFlaimPaths) {
    if (!expectedPath.startsWith("/")) {
      throw new Error("Expected Flaim paths must start with /");
    }
  }

  return manifest;
}
