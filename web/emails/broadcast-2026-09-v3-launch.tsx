import * as React from "react";
import { Button, Section } from "react-email";

import {
  FlaimEmailLayout,
  FlaimFooterLink,
  FlaimText,
} from "./components/FlaimEmailLayout";
import { previewUnsubscribeUrl } from "./broadcast-manifest";
import { emailBrand } from "./brand";
import { withEmailRef } from "./link-ref";

const campaign = "email-flaim-3-chatgpt-launch";

interface FlaimThreeLaunchBroadcastEmailProps {
  chatGptAppUrl?: string;
  unsubscribeUrl?: string;
}

export default function FlaimThreeLaunchBroadcastEmail({
  chatGptAppUrl =
    "https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36",
  unsubscribeUrl = previewUnsubscribeUrl,
}: FlaimThreeLaunchBroadcastEmailProps) {
  return (
    <FlaimEmailLayout
      eyebrow="FLAIM 3.0"
      footerDisclosure={
        <>
          You are receiving this because you signed up for a Flaim account. {" "}
          <FlaimFooterLink href={unsubscribeUrl}>Unsubscribe</FlaimFooterLink>.
          <br />
          Need help? Reply to this email.
        </>
      }
      footerSupport={false}
      headerUrl={withEmailRef(emailBrand.url, campaign)}
      preview="Draft results, pick ownership, and deeper ESPN football matchup context are now available."
      title="Flaim 3.0 is now live in ChatGPT"
    >
      <FlaimText>Hey everyone,</FlaimText>
      <FlaimText>
        OpenAI has approved Flaim 3.0 for ChatGPT. This update makes it easier
        to ask better questions about your real leagues while keeping Flaim
        simple and grounded in your actual data.
      </FlaimText>
      <FlaimText>Here&apos;s what&apos;s new:</FlaimText>
      <ul style={styles.updateList}>
        <li style={styles.updateItem}>
          <strong>Completed draft results by round and team.</strong> Review the
          picks that actually happened in your league, including draft position
          and auction costs where they are available.
        </li>
        <li style={styles.updateItem}>
          <strong>Clearer pick ownership.</strong> Flaim now distinguishes the
          team that originally selected a pick from the team that currently owns
          it. That is especially useful for Sleeper leagues with traded picks.
        </li>
        <li style={styles.updateItem}>
          <strong>Deeper ESPN football matchup context.</strong> Explore
          player-level lineup and scoring detail for completed football matchups.
        </li>
      </ul>
      <FlaimText>
        Flaim is still read-only. It can help you understand your leagues, but
        it will never change your roster, lineup, waivers, or trades.
      </FlaimText>
      <Section style={styles.actionSection}>
        <Button href={chatGptAppUrl} style={styles.actionButton}>
          Open Flaim in ChatGPT
        </Button>
      </Section>
      <FlaimText>Thanks,</FlaimText>
      <FlaimText>Gerry</FlaimText>
    </FlaimEmailLayout>
  );
}

FlaimThreeLaunchBroadcastEmail.PreviewProps = {
  chatGptAppUrl:
    "https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36",
  unsubscribeUrl: previewUnsubscribeUrl,
} satisfies FlaimThreeLaunchBroadcastEmailProps;

const styles = {
  updateList: {
    color: emailBrand.colors.foreground,
    fontSize: "15px",
    lineHeight: "24px",
    margin: "0 0 16px",
    paddingLeft: "20px",
  },
  updateItem: {
    margin: "0 0 12px",
    paddingLeft: "4px",
  },
  actionSection: {
    margin: "8px 0 20px",
    textAlign: "center" as const,
  },
  actionButton: {
    backgroundColor: emailBrand.colors.primary,
    borderRadius: emailBrand.radius.button,
    color: emailBrand.colors.primaryForeground,
    display: "block",
    fontSize: "14px",
    fontWeight: "600",
    lineHeight: "20px",
    padding: "12px 16px",
    textAlign: "center" as const,
    textDecoration: "none",
  },
} as const;
