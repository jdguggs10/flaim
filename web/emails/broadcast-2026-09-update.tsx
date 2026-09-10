import * as React from "react";
import { Button, Column, Row, Section } from "react-email";
import {
  FlaimCallout,
  FlaimCalloutText,
  FlaimEmailLayout,
  FlaimFooterLink,
  FlaimText,
} from "./components/FlaimEmailLayout";
import { emailBrand } from "./brand";
import { withEmailRef } from "./link-ref";

const campaign = "email-sep-2026-update";

interface SeptemberUpdateBroadcastEmailProps {
  chatGptAppUrl?: string;
  claudeConnectorUrl?: string;
  leaguesUrl?: string;
  unsubscribeUrl?: string;
}

export default function SeptemberUpdateBroadcastEmail({
  chatGptAppUrl =
    "https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36",
  claudeConnectorUrl =
    "https://claude.ai/directory/connectors/f1a5b6a4-1f5b-470c-af23-71fc7ab13754",
  leaguesUrl = "https://flaim.app/leagues",
  unsubscribeUrl = "{{{RESEND_UNSUBSCRIBE_URL}}}",
}: SeptemberUpdateBroadcastEmailProps) {
  const homeUrl = withEmailRef(emailBrand.url, campaign);
  const attributedLeaguesUrl = withEmailRef(leaguesUrl, campaign);

  return (
    <FlaimEmailLayout
      eyebrow="PRODUCT UPDATES"
      footerDisclosure={
        <>
          You are receiving this because you signed up for a Flaim account. {" "}
          <FlaimFooterLink href={unsubscribeUrl}>Unsubscribe</FlaimFooterLink>.
        </>
      }
      headerUrl={homeUrl}
      preview="Plus deeper ESPN history and more ways to use Flaim with your favorite AI."
      title="Football is Back!"
    >
      <FlaimText>In celebration, a few Flaim updates:</FlaimText>
      <ul style={styles.updateList}>
        <li style={styles.updateItem}>
          <strong>Draft results are here!</strong> See your actual ESPN and
          Sleeper picks, draft positions, and auction costs where available.
        </li>
        <li style={styles.updateItem}>
          <strong>More ESPN history and detail.</strong> Explore pre-2018 seasons
          where available, plus starters, bench players, and points for
          football matchups from 2018 onward.
        </li>
        <li style={styles.updateItem}>
          <strong>More ways to use Flaim.</strong> In addition to official ChatGPT
          and Claude support, Perplexity, Grok, and Gemini are also available as
          custom connectors.{" "}
          <a
            href={withEmailRef("https://flaim.app/docs/ai", campaign)}
            style={styles.inlineLink}
          >
            See docs for more.
          </a>
        </li>
      </ul>
      <FlaimText>
        Feedback is always appreciated:{" "}
        <a href="mailto:support@flaim.app" style={styles.inlineLink}>
          support@flaim.app
        </a>
      </FlaimText>

      <FlaimCallout>
        <FlaimCalloutText>
          <strong>Yahoo is back!</strong>
          <br />
          Most Yahoo leagues have been restored and automatically refreshed.
          There&apos;s a small percent I&apos;m still working through. If you have
          issues seeing your leagues, please let me know.
        </FlaimCalloutText>
      </FlaimCallout>

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

SeptemberUpdateBroadcastEmail.PreviewProps = {
  chatGptAppUrl:
    "https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36",
  claudeConnectorUrl:
    "https://claude.ai/directory/connectors/f1a5b6a4-1f5b-470c-af23-71fc7ab13754",
  leaguesUrl: "https://flaim.app/leagues",
  unsubscribeUrl: "{{{RESEND_UNSUBSCRIBE_URL}}}",
} satisfies SeptemberUpdateBroadcastEmailProps;

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
