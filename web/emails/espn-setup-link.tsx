import * as React from "react";
import {
  FlaimButton,
  FlaimDivider,
  FlaimEmailLayout,
  FlaimFooterLink,
  FlaimMutedText,
  FlaimText,
} from "./components/FlaimEmailLayout";

interface EspnSetupLinkEmailProps {
  extensionUrl: string;
  leaguesUrl: string;
}

export default function EspnSetupLinkEmail({
  extensionUrl,
  leaguesUrl,
}: EspnSetupLinkEmailProps) {
  return (
    <FlaimEmailLayout
      eyebrow="ESPN SETUP"
      footerDescription="Flaim connects your real fantasy leagues to your AI assistant for read-only, league-specific analysis."
      footerDisclosure="You're receiving this one-time email because you requested an ESPN setup link from your Flaim leagues page."
      preview="Your ESPN setup link. Takes sixty seconds on a computer."
      title="Finish ESPN setup on your computer"
    >
      <FlaimText>
        ESPN is the one platform that needs a computer. Credentials link
        through a Chrome extension.
      </FlaimText>
      <FlaimText>
        Next time you&apos;re at a computer, open flaim.app/leagues and follow
        the ESPN steps. The whole thing takes sixty seconds.
      </FlaimText>
      <FlaimButton href={leaguesUrl}>Open your leagues page</FlaimButton>
      <FlaimDivider />
      <FlaimMutedText>
        Want to jump straight to the extension? It&apos;s{" "}
        <FlaimFooterLink href={extensionUrl}>
          here on the Chrome Web Store
        </FlaimFooterLink>
        . Yahoo and Sleeper don&apos;t need any of this. They connect right
        from your phone.
      </FlaimMutedText>
    </FlaimEmailLayout>
  );
}

EspnSetupLinkEmail.PreviewProps = {
  extensionUrl:
    "https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn",
  leaguesUrl: "https://flaim.app/leagues",
} satisfies EspnSetupLinkEmailProps;
