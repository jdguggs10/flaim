import * as React from "react";
import {
  FlaimButton,
  FlaimCallout,
  FlaimCalloutText,
  FlaimEmailLayout,
  FlaimFooterLink,
  FlaimText,
} from "./components/FlaimEmailLayout";

interface WelcomeEmailProps {
  firstName?: string;
  leaguesUrl: string;
  /** Must be a real unsubscribe or notification-preferences URL before connecting to a live sender. */
  unsubscribeUrl: string;
}

export default function WelcomeEmail({
  firstName = "Alex",
  leaguesUrl,
  unsubscribeUrl,
}: WelcomeEmailProps) {
  return (
    <FlaimEmailLayout
      eyebrow="WELCOME"
      footerDescription="Flaim connects your real fantasy leagues to your AI assistant for read-only, league-specific analysis."
      footerDisclosure={
        <>
          You are receiving this because you created a Flaim account.{" "}
          <FlaimFooterLink href={unsubscribeUrl}>Unsubscribe</FlaimFooterLink>
          .
        </>
      }
      preview="Connect a league to start using Flaim with your AI assistant."
      title="Connect your first league"
    >
      <FlaimText>Hi {firstName},</FlaimText>
      <FlaimText>
        Flaim is ready when you are. Connect ESPN, Yahoo, or Sleeper to ChatGPT
        to ask questions using your actual roster, standings, and league data.
        Include web search to get updated stats, waiver wire adds, trade
        targets, and more. Enjoy.
      </FlaimText>
      <FlaimButton href={leaguesUrl}>Open league setup</FlaimButton>
      <FlaimCallout>
        <FlaimCalloutText>
          Flaim is read-only. It can access your league data, but it cannot set
          lineups, drop players, make trades, or change league settings.
        </FlaimCalloutText>
      </FlaimCallout>
    </FlaimEmailLayout>
  );
}

WelcomeEmail.PreviewProps = {
  firstName: "Alex",
  leaguesUrl: "https://flaim.app/leagues",
  unsubscribeUrl: "https://flaim.app/notifications/unsubscribe?token=PREVIEW_ONLY",
} satisfies WelcomeEmailProps;
