import * as React from "react";
import { Button, Column, Row, Section } from "react-email";
import {
  FlaimCallout,
  FlaimCalloutText,
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
      headerUrl={homeUrl}
      preview="Waiver priority, FAAB budgets, smarter free agents, and a steadier Yahoo."
      title="Waivers, hockey, and a steadier Yahoo"
    >
      <FlaimText>Hey everyone,</FlaimText>
      <FlaimText>
        It&apos;s been a busy few weeks since kickoff. Here&apos;s what&apos;s
        new:
      </FlaimText>
      <ul style={styles.updateList}>
        <li style={styles.updateItem}>
          <strong>Hockey is underway.</strong> The NHL season just started, and
          Flaim works with your ESPN and Yahoo hockey leagues using the same
          connection as football. Basketball too once the NBA tips off. Yahoo
          category leagues now show how each category stands in your matchup.
          Winter sports are newer territory for me, so if anything looks off,
          let me know.
        </li>
        <li style={styles.updateItem}>
          <strong>Better waiver help.</strong> Standings now include your waiver
          priority and remaining FAAB budget (Yahoo and Sleeper). ESPN free
          agents come with season points, points per game, and projections.
          Sleeper free agents are sorted by who&apos;s getting picked up most,
          and Yahoo free agent lists no longer stop at 25. Try asking:
          &quot;Who should I bid on this week, and how much of my FAAB should I
          spend?&quot;
        </li>
        <li style={styles.updateItem}>
          <strong>A steadier Yahoo.</strong> Football leagues that went missing
          after a sync now show up, errors tell you what to do next, and rosters
          show weekly points for each player. If Yahoo gave you trouble earlier,
          give it another try.
        </li>
      </ul>
      <FlaimText>A few smaller things:</FlaimText>
      <ul style={styles.updateList}>
        <li style={styles.updateItem}>
          ESPN setup is smoother in the latest Chrome extension, with a new{" "}
          <a href={espnGuideUrl} style={styles.inlineLink}>
            setup guide
          </a>{" "}
          at flaim.app/docs/espn.
        </li>
        <li style={styles.updateItem}>
          Don&apos;t want the league card in every reply? There&apos;s now a
          switch on your{" "}
          <a href={attributedLeaguesUrl} style={styles.inlineLink}>
            leagues page
          </a>{" "}
          to hide it.
        </li>
        <li style={styles.updateItem}>
          The league card works better in Claude: refresh, dark mode, and links
          all behave.
        </li>
      </ul>

      <FlaimCallout>
        <FlaimCalloutText>
          <strong>Privacy policy update.</strong> I updated the privacy policy
          and terms. They now explain more clearly how your league data reaches
          ChatGPT or Claude when you ask a question, and what would happen to
          your account if Flaim were ever sold: a new owner would have to keep
          these promises and ask your permission before using your data
          differently. Nothing changes about how Flaim works today. Your ESPN
          and Yahoo logins never go to the AI, and Flaim never changes your
          leagues.{" "}
          <a href={privacyUrl} style={styles.inlineLink}>
            Read the privacy policy
          </a>
          .
        </FlaimCalloutText>
      </FlaimCallout>

      <FlaimText>
        Feedback is always appreciated at{" "}
        <a href="mailto:support@flaim.app" style={styles.inlineLink}>
          support@flaim.app
        </a>
        , or just reply to this email.
      </FlaimText>
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
