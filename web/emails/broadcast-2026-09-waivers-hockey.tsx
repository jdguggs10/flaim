import * as React from "react";
import { Button, Column, Row, Section } from "react-email";
import {
  BroadcastHero,
  GerryNote,
  ReportHeader,
  ReportLink,
  ReportSection,
  TryThis,
} from "./components/BroadcastBlocks";
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
  // No default GIF on purpose: Gerry picks one before sending. Empty renders
  // no hero image.
  gifUrl?: string;
  leaguesUrl?: string;
  unsubscribeUrl?: string;
}

export default function WaiversHockeyBroadcastEmail({
  chatGptAppUrl =
    "https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36",
  claudeConnectorUrl =
    "https://claude.ai/directory/connectors/f1a5b6a4-1f5b-470c-af23-71fc7ab13754",
  gifUrl = "",
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
      // DRAFT headline: Gerry may rewrite before sending.
      title="The best time of year."
    >
      <BroadcastHero alt="Hockey player winding up a shot" gifUrl={gifUrl} />

      <GerryNote
        paragraphs={[
          // DRAFT note from Gerry's dictated notes; he edits before sending.
          "Football's a few weeks in, hockey just dropped the puck, basketball's around the corner, and the baseball playoffs are starting. It doesn't get better than this.",
          "It's also been a wild few weeks for Flaim. At the start of the summer, fewer than 200 people had signed up. Today it's almost 17,000. Keeping everything afloat through that, plus getting Yahoo back online, has been a grind. But things feel stable now, and hearing from so many of you that this is actually useful has been the most energizing part.",
          "So thanks for giving this a shot. Seriously. If you've got ideas, complaints, or a trade you want a second opinion on, just hit reply.",
        ]}
      />

      <ReportHeader />

      <ReportSection
        label="Called up"
        items={[
          "Hockey works on ESPN and Yahoo. Basketball's ready for tip-off.",
          "Winter sports are newer for Flaim. If something looks off, tell me.",
        ]}
      />
      <ReportSection
        label="Waiver wire"
        items={[
          "Standings now show your waiver priority and FAAB left (Yahoo, Sleeper).",
          "ESPN free agents come with points per game and projections.",
          "Sleeper free agents are sorted by who's getting added most.",
          "Yahoo free-agent lists go past 25 now.",
        ]}
      />
      <ReportSection
        label="Off the injury report"
        items={[
          "Yahoo: missing football leagues show up again, errors tell you what to do next, and rosters show weekly points. Upgraded from questionable to probable.",
          "Sleeper: rosters and matchups now show each player's points for the week.",
        ]}
      />
      <ReportSection
        label="Front office"
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
        label="Commissioner's desk"
        tone="normal"
        items={[
          <>
            I updated the privacy policy and terms. They now explain how your
            league data reaches ChatGPT or Claude, that deleting your account
            also unsubscribes you from these emails, and that if Flaim were ever
            sold, the new owner would have to keep these promises.{" "}
            <ReportLink href={privacyUrl}>Read the update</ReportLink>.
          </>,
        ]}
      />

      <TryThis prompt="Who should I bid on this week, and how much FAAB should I spend?" />

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
  gifUrl: "",
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
