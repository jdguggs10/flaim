import * as React from "react";
import {
  FlaimButton,
  FlaimDivider,
  FlaimEmailLayout,
  FlaimMutedText,
  FlaimText,
} from "./components/FlaimEmailLayout";

interface LeagueConnectedEmailProps {
  aiGuideUrl?: string;
  leagueName?: string;
  platform?: string;
}

export default function LeagueConnectedEmail({
  aiGuideUrl = "https://flaim.app/guide/ai",
  leagueName = "Acme Fantasy League",
  platform = "Yahoo",
}: LeagueConnectedEmailProps) {
  return (
    <FlaimEmailLayout
      eyebrow="League connected"
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
};
