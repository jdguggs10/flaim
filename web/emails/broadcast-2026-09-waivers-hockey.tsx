import * as React from "react";
import { Button, Column, Row, Section } from "react-email";
import {
  GerryNote,
  ReportHeader,
  ReportLink,
  ReportSection,
} from "./components/BroadcastBlocks";
import { FlaimEmailLayout, FlaimFooterLink } from "./components/FlaimEmailLayout";
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
      title="The best time of year."
    >
      <GerryNote
        paragraphs={[
          "Football's kicked off, hockey is starting, basketball's around the corner, and postseason baseball is here. The sports equinox.",
          "It's also been a wild few weeks for Flaim. At the start of the summer, a couple hundred people had found Flaim. Today, there are about 100 times that many of you. Remarkable.",
          "Scaling to all of you has made for a hell of a month, and your feedback on bugs, use cases, and feature requests has been deeply appreciated. Please keep sharing.",
          "Most of all, thanks for giving Flaim a shot.",
        ]}
      />

      <ReportHeader title="FIXES AND UPDATES" intro="Everything that changed since kickoff." />

      <ReportSection
        label="Puck and bball"
        items={[
          "Hockey is confirmed working for ESPN and Yahoo, and basketball should also be ready for tip-off.",
          "Winter sports are newer for Flaim. If something looks off, tell me.",
        ]}
      />
      <ReportSection
        label="Waiver wire improvements"
        items={[
          "Standings now show your waiver priority and FAAB left (Yahoo, Sleeper).",
          "ESPN free agents come with points per game and projections.",
          "Sleeper free agents are sorted by who's getting added most.",
          "Yahoo free-agent lists go past 25 now.",
        ]}
      />
      <ReportSection
        label="Misc fixes"
        items={[
          "Yahoo: missing football leagues show up again, errors tell you what to do next, and rosters show weekly points. Upgraded from questionable to probable.",
          "ESPN: standings now match ESPN's order and count ties correctly.",
          "Sleeper: rosters and matchups show each player's points for the week, and drops no longer show up as adds.",
        ]}
      />
      <ReportSection
        label="Hide league card and more"
        items={[
          <>
            Easier ESPN setup, plus a new{" "}
            <ReportLink href={espnGuideUrl}>setup guide</ReportLink>.
          </>,
          <>
            Want less clutter? Hide the league card from your{" "}
            <ReportLink href={attributedLeaguesUrl}>leagues page</ReportLink>.
          </>,
          "The league card works better in Claude: refresh, dark mode, links.",
        ]}
      />
      <ReportSection
        label="Privacy"
        tone="normal"
        items={[
          <>
            Privacy policy and terms were updated. They now explain how your
            league data reaches ChatGPT or Claude, that deleting your account
            also unsubscribes you from these emails, and what would happen if
            Flaim were ever sold (the new owner would have to keep these
            promises).{" "}
            <ReportLink href={privacyUrl}>Read here</ReportLink>.
          </>,
        ]}
      />

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
    margin: "8px 0 8px",
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
} as const;
