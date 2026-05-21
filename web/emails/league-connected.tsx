import * as React from "react";
import {
  FlaimButton,
  FlaimDivider,
  FlaimEmailLayout,
  FlaimFooterLink,
  FlaimMutedText,
  FlaimText,
} from "./components/FlaimEmailLayout";

interface LeagueConnectedEmailProps {
  aiGuideUrl: string;
  leagueName?: string;
  platform?: string;
  /** Must be a real unsubscribe or notification-preferences URL before connecting to a live sender. */
  unsubscribeUrl: string;
}

export default function LeagueConnectedEmail({
  aiGuideUrl,
  leagueName = "Acme Fantasy League",
  platform = "Yahoo",
  unsubscribeUrl,
}: LeagueConnectedEmailProps) {
  return (
    <FlaimEmailLayout
      eyebrow="LEAGUE CONNECTED"
      footerDescription="Flaim connects your real fantasy leagues to your AI assistant for read-only, league-specific analysis."
      footerDisclosure={
        <>
          You are receiving this because a league was connected to your Flaim
          account.{" "}
          <FlaimFooterLink href={unsubscribeUrl}>Unsubscribe</FlaimFooterLink>
          .
        </>
      }
      preview={`${leagueName} is connected to Flaim.`}
      title={`${leagueName} is ready`}
    >
      <FlaimText>
        Your {platform} league is connected. Flaim can now provide read-only
        league context to supported AI assistants.
      </FlaimText>
      <FlaimText>
        Add Flaim to Claude, ChatGPT, or Perplexity, then ask about your roster,
        matchup, waiver options, standings, and recent transactions.
      </FlaimText>
      <FlaimButton href={aiGuideUrl}>Connect your AI assistant</FlaimButton>
      <FlaimDivider />
      <FlaimMutedText>
        Not expecting this? You can disconnect league access from your Flaim
        leagues page.
      </FlaimMutedText>
    </FlaimEmailLayout>
  );
}

LeagueConnectedEmail.PreviewProps = {
  aiGuideUrl: "https://flaim.app/guide/ai",
  leagueName: "Acme Fantasy League",
  platform: "Yahoo",
  unsubscribeUrl: "https://flaim.app/notifications/unsubscribe?token=PREVIEW_ONLY",
} satisfies LeagueConnectedEmailProps;
