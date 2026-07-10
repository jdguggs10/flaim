import * as React from "react";
import {
  FlaimButton,
  FlaimCallout,
  FlaimEmailLayout,
  FlaimText,
} from "./components/FlaimEmailLayout";

interface MarketingBroadcastPoint {
  body: React.ReactNode;
  title: string;
}

interface MarketingBroadcastEmailProps {
  body?: React.ReactNode;
  ctaHref: string;
  ctaLabel: string;
  eyebrow?: string;
  footerDescription?: React.ReactNode;
  footerDisclosure: React.ReactNode;
  firstName?: string;
  points?: MarketingBroadcastPoint[];
  preview: string;
  title: string;
}

export default function MarketingBroadcastEmail({
  body,
  ctaHref,
  ctaLabel,
  eyebrow = "PRODUCT UPDATE",
  footerDescription,
  footerDisclosure,
  firstName = "Alex",
  points = [],
  preview,
  title,
}: MarketingBroadcastEmailProps) {
  return (
    <FlaimEmailLayout
      eyebrow={eyebrow}
      footerDescription={footerDescription}
      footerDisclosure={footerDisclosure}
      preview={preview}
      title={title}
    >
      <FlaimText>Hi {firstName},</FlaimText>
      {body ? <FlaimText>{body}</FlaimText> : null}
      {points.length > 0 ? (
        <FlaimCallout>
          {points.map((point) => (
            <FlaimText key={point.title}>
              <strong>{point.title}</strong> {point.body}
            </FlaimText>
          ))}
        </FlaimCallout>
      ) : null}
      <FlaimButton href={ctaHref}>{ctaLabel}</FlaimButton>
    </FlaimEmailLayout>
  );
}

MarketingBroadcastEmail.PreviewProps = {
  body:
    "This starter keeps the layout, button treatment, and footer consistent for one-off product announcements and recurring marketing broadcasts.",
  ctaHref: "https://flaim.app/leagues",
  ctaLabel: "Review leagues",
  footerDisclosure:
    "You are receiving this because you have a Flaim account. Unsubscribe.",
  firstName: "Alex",
  points: [
    {
      body: "Use this template when you need a simple launch or release note broadcast.",
      title: "What it is",
    },
    {
      body: "Keep the copy short, punchy, and easy to scan in the Resend editor.",
      title: "How to use it",
    },
    {
      body: "Swap in campaign-specific content, export HTML, then update the draft in Resend.",
      title: "Workflow",
    },
  ],
  preview:
    "A reusable starting point for Flaim marketing broadcasts and product announcements.",
  title: "Marketing broadcast template",
} satisfies MarketingBroadcastEmailProps;
