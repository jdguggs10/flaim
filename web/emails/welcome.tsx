import * as React from "react";
import {
  FlaimButton,
  FlaimCallout,
  FlaimEmailLayout,
  FlaimMutedText,
  FlaimText,
} from "./components/FlaimEmailLayout";

interface WelcomeEmailProps {
  firstName?: string;
  leaguesUrl?: string;
}

export default function WelcomeEmail({
  firstName = "Gerry",
  leaguesUrl = "https://flaim.app/leagues",
}: WelcomeEmailProps) {
  return (
    <FlaimEmailLayout
      eyebrow="Welcome"
      preview="Connect a league to start using Flaim with your AI assistant."
      title="Connect your first league"
    >
      <FlaimText>Hi {firstName},</FlaimText>
      <FlaimText>
        Flaim is ready when you are. Connect ESPN, Yahoo, or Sleeper, then ask
        your AI assistant questions that use your actual roster, standings, and
        league context.
      </FlaimText>
      <FlaimButton href={leaguesUrl}>Open league setup</FlaimButton>
      <FlaimCallout>
        <FlaimMutedText>
          Flaim is read-only. It can inspect your league data, but it cannot set
          lineups, drop players, make trades, or change league settings.
        </FlaimMutedText>
      </FlaimCallout>
      <FlaimMutedText>
        If you already connected a league, you can ignore this email.
      </FlaimMutedText>
    </FlaimEmailLayout>
  );
}

WelcomeEmail.PreviewProps = {
  firstName: "Gerry",
  leaguesUrl: "https://flaim.app/leagues",
};
