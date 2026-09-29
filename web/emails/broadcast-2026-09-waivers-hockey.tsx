import * as React from "react";
import { Button, Column, Row, Section } from "react-email";
import {
  FlaimEmailLayout,
  FlaimFooterLink,
  FlaimText,
} from "./components/FlaimEmailLayout";
import { previewUnsubscribeUrl } from "./broadcast-manifest";
import { emailBrand } from "./brand";
import { withEmailRef } from "./link-ref";

const campaign = "email-sep-2026-waivers-hockey";

interface WaiversHockeyBroadcastEmailProps {
  chatGptAppUrl?: string;
  claudeConnectorUrl?: string;
  leaguesUrl?: string;
  unsubscribeUrl?: string;
}

export default function WaiversHockeyBroadcastEmail({
  chatGptAppUrl =
    "https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36",
  claudeConnectorUrl =
    "https://claude.ai/directory/connectors/f1a5b6a4-1f5b-470c-af23-71fc7ab13754",
  leaguesUrl = "https://flaim.app/leagues",
  unsubscribeUrl = previewUnsubscribeUrl,
}: WaiversHockeyBroadcastEmailProps) {
  const homeUrl = withEmailRef(emailBrand.url, campaign);
  const attributedLeaguesUrl = withEmailRef(leaguesUrl, campaign);
  const espnGuideUrl = withEmailRef("https://flaim.app/docs/espn", campaign);
  const privacyUrl = withEmailRef("https://flaim.app/privacy", campaign);

  return (
    <FlaimEmailLayout
      eyebrow="PRODUCT UPDATES"
      footerDisclosure={
        <>
          You are receiving this because you signed up for a Flaim account. {" "}
          <FlaimFooterLink href={unsubscribeUrl}>Unsubscribe</FlaimFooterLink>.
        </>
      }
      footerDescription={
        <>
          I also clarified the privacy policy and terms.{" "}
          <FlaimFooterLink href={privacyUrl}>Read the update.</FlaimFooterLink>
        </>
      }
      headerUrl={homeUrl}
      preview="Waiver priority, FAAB budgets, smarter free agents, and a steadier Yahoo."
      title="Waivers, hockey, and a steadier Yahoo"
    >
      <FlaimText>Hey everyone, a few quick updates:</FlaimText>
      <ul style={styles.updateList}>
        <li style={styles.updateItem}>
          <strong>Hockey is here.</strong> Connect your ESPN and Yahoo hockey
          leagues just like football. Basketball works too.
        </li>
        <li style={styles.updateItem}>
          <strong>Better waiver help.</strong> Flaim now sees Yahoo and Sleeper
          waiver priority and FAAB budgets, plus better free-agent detail across
          all three platforms.
        </li>
        <li style={styles.updateItem}>
          <strong>Yahoo is more reliable.</strong> Missing football leagues,
          sync errors, and weekly player points got fixes. If you had trouble
          earlier, give it another try.
        </li>
        <li style={styles.updateItem}>
          <strong>Easier ESPN setup.</strong> The latest Chrome extension and{" "}
          <a href={espnGuideUrl} style={styles.inlineLink}>
            setup guide
          </a>{" "}
          make connecting simpler.
        </li>
        <li style={styles.updateItem}>
          <strong>A better league card.</strong> Refresh, dark mode, and links
          work better in Claude. Prefer less clutter? Hide the card from your{" "}
          <a href={attributedLeaguesUrl} style={styles.inlineLink}>
            leagues page
          </a>
          .
        </li>
      </ul>

      <FlaimText>As always, keep the feedback coming. Just reply to this email.</FlaimText>
      <FlaimText>Gerry</FlaimText>

      <Section style={styles.actionSection}>
        <Button href={attributedLeaguesUrl} style={styles.leaguesButton}>
          Manage your leagues
        </Button>
      </Section>
      <Section style={styles.assistantButtons}>
        <Row data-text-stack="true">
          <Column style={styles.assistantColumn}>
            <Button href={chatGptAppUrl} style={styles.assistantButton}>
              Ask Flaim in ChatGPT
            </Button>
          </Column>
          <Column style={styles.assistantColumnLast}>
            <Button href={claudeConnectorUrl} style={styles.assistantButton}>
              Ask Flaim in Claude
            </Button>
          </Column>
        </Row>
      </Section>
    </FlaimEmailLayout>
  );
}

WaiversHockeyBroadcastEmail.PreviewProps = {
  chatGptAppUrl:
    "https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36",
  claudeConnectorUrl:
    "https://claude.ai/directory/connectors/f1a5b6a4-1f5b-470c-af23-71fc7ab13754",
  leaguesUrl: "https://flaim.app/leagues",
  unsubscribeUrl: previewUnsubscribeUrl,
} satisfies WaiversHockeyBroadcastEmailProps;

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
    margin: "8px 0 4px",
    textAlign: "center" as const,
  },
  leaguesButton: {
    backgroundColor: "#ffffff",
    borderColor: emailBrand.colors.border,
    borderRadius: emailBrand.radius.button,
    borderStyle: "solid",
    borderWidth: "1px",
    color: emailBrand.colors.foreground,
    display: "block",
    fontSize: "14px",
    fontWeight: "600",
    lineHeight: "20px",
    padding: "12px 16px",
    textAlign: "center" as const,
    textDecoration: "none",
  },
  assistantButtons: {
    margin: "8px 0 20px",
  },
  assistantColumn: {
    padding: "0 4px 0 0",
    width: "50%",
  },
  assistantColumnLast: {
    padding: "0 0 0 4px",
    width: "50%",
  },
  assistantButton: {
    backgroundColor: emailBrand.colors.primary,
    borderRadius: emailBrand.radius.button,
    color: emailBrand.colors.primaryForeground,
    display: "block",
    fontSize: "14px",
    fontWeight: "600",
    lineHeight: "20px",
    padding: "12px 8px",
    textAlign: "center" as const,
    textDecoration: "none",
  },
  inlineLink: {
    color: emailBrand.colors.foreground,
    textDecoration: "underline",
  },
} as const;
