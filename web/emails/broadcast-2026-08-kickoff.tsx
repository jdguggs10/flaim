import * as React from "react";
import { Button, Column, Row, Section } from "react-email";
import {
  FlaimEmailLayout,
  FlaimFooterLink,
  FlaimText,
} from "./components/FlaimEmailLayout";
import { emailBrand } from "./brand";
import { withEmailRef } from "./link-ref";

const campaign = "email-aug-kickoff";

interface KickoffBroadcastEmailProps {
  chatGptAppUrl?: string;
  claudeConnectorUrl?: string;
  leaguesUrl?: string;
  unsubscribeUrl?: string;
}

export default function KickoffBroadcastEmail({
  chatGptAppUrl =
    "https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36",
  claudeConnectorUrl =
    "https://claude.ai/directory/connectors/f1a5b6a4-1f5b-470c-af23-71fc7ab13754",
  leaguesUrl = "https://flaim.app/leagues",
  unsubscribeUrl = "{{{RESEND_UNSUBSCRIBE_URL}}}",
}: KickoffBroadcastEmailProps) {
  const homeUrl = withEmailRef(emailBrand.url, campaign);
  const attributedLeaguesUrl = withEmailRef(leaguesUrl, campaign);

  return (
    <FlaimEmailLayout
      eyebrow="PRODUCT UPDATES"
      footerDisclosure={
        <>
          You are receiving this because a league is connected to your Flaim
          account. <FlaimFooterLink href={unsubscribeUrl}>Unsubscribe</FlaimFooterLink>.
        </>
      }
      headerUrl={homeUrl}
      preview="Keeper costs, dynasty draft picks, and sharper trade detail for your connected leagues."
      title="Draft season is here"
    >
      <FlaimText>Hey everyone, some news and updates below:</FlaimText>
      <FlaimText>
        Keeper and draft questions are ready. Flaim now reads your league&apos;s
        keeper and draft setup. Keeper counts, deadlines, auction budgets, and
        draft formats are all in there too (platform dependent). Good stuff.
      </FlaimText>
      <FlaimText>
        Sleeper integration got better. Real player and team names everywhere.
        Rosters, matchups, transactions all have accuracy improvements. No big
        headline here, just better across the board.
      </FlaimText>
      <FlaimText>
        ESPN detail got deeper. Trade history is back in full color, who got
        who, all of it. FAAB bids are now in the data flow, which is very nice.
        And past-week rosters now come back the way they actually were. It&apos;s
        the little things.
      </FlaimText>
      <FlaimText>
        Yahoo: We&apos;re still not re-activated, and it is incredibly frustrating.
        There was some progress behind the scenes since my last email, but
        yeah, this is brutal...
      </FlaimText>

      <Section style={styles.actionSection}>
        <Button href={attributedLeaguesUrl} style={styles.leaguesButton}>
          Manage your leagues
        </Button>
      </Section>
      <Section style={styles.assistantButtons}>
        <Row>
          <Column style={styles.assistantColumn}>
            <Button href={chatGptAppUrl} style={styles.assistantButton}>
              Add to ChatGPT
            </Button>
          </Column>
          <Column style={styles.assistantColumnLast}>
            <Button href={claudeConnectorUrl} style={styles.assistantButton}>
              Add to Claude
            </Button>
          </Column>
        </Row>
      </Section>

      <FlaimText>
        As always, I appreciate any and all feedback. Your outreach has
        directly led to a host of fixes over the past few weeks. Please keep it
        coming. Share on threads or hit me directly at{" "}
        <a href="mailto:gerry@flaim.app" style={styles.inlineLink}>
          gerry@flaim.app
        </a>
        .
      </FlaimText>
    </FlaimEmailLayout>
  );
}

KickoffBroadcastEmail.PreviewProps = {
  chatGptAppUrl:
    "https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36",
  claudeConnectorUrl:
    "https://claude.ai/directory/connectors/f1a5b6a4-1f5b-470c-af23-71fc7ab13754",
  leaguesUrl: "https://flaim.app/leagues",
  unsubscribeUrl: "{{{RESEND_UNSUBSCRIBE_URL}}}",
} satisfies KickoffBroadcastEmailProps;

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
