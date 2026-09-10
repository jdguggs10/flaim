import * as React from "react";
import { Img } from "react-email";
import {
  FlaimEmailLayout,
  FlaimFooterLink,
} from "./components/FlaimEmailLayout";
import { emailBrand } from "./brand";
import { withEmailRef } from "./link-ref";

const campaign = "email-yahoo-back-sep-2026";

interface YahooBackBroadcastEmailProps {
  gifUrl?: string;
  unsubscribeUrl?: string;
}

export default function YahooBackBroadcastEmail({
  gifUrl = "https://media1.tenor.com/m/GMQO9zwZ_QgAAAAd/slow-clap-gardner.gif",
  unsubscribeUrl = "{{{RESEND_UNSUBSCRIBE_URL}}}",
}: YahooBackBroadcastEmailProps) {
  return (
    <FlaimEmailLayout
      footerDisclosure={
        <>
          You are receiving this because Yahoo is connected to your Flaim
          account. <FlaimFooterLink href={unsubscribeUrl}>Unsubscribe</FlaimFooterLink>.
        </>
      }
      headerUrl={withEmailRef(emailBrand.url, campaign)}
      preview="Yahoo access is back in Flaim."
      title="YAHOO IS BACK"
    >
      <Img
        alt="Brett Gardner applauding"
        src={gifUrl}
        style={styles.gif}
        width="512"
      />
    </FlaimEmailLayout>
  );
}

YahooBackBroadcastEmail.PreviewProps = {
  gifUrl: "https://media1.tenor.com/m/GMQO9zwZ_QgAAAAd/slow-clap-gardner.gif",
  unsubscribeUrl: "{{{RESEND_UNSUBSCRIBE_URL}}}",
} satisfies YahooBackBroadcastEmailProps;

const styles = {
  gif: {
    display: "block",
    height: "auto",
    margin: "0",
    maxWidth: "100%",
    width: "100%",
  },
} as const;
