import * as React from "react";
import {
  FlaimEmailLayout,
  FlaimFooterLink,
  FlaimText,
} from "./components/FlaimEmailLayout";
import { emailBrand } from "./brand";
import { withEmailRef } from "./link-ref";

const campaign = "email-yahoo-access-aug-2026";

interface YahooAccessBroadcastEmailProps {
  unsubscribeUrl?: string;
}

export default function YahooAccessBroadcastEmail({
  unsubscribeUrl = "{{{RESEND_UNSUBSCRIBE_URL}}}",
}: YahooAccessBroadcastEmailProps) {
  return (
    <FlaimEmailLayout
      eyebrow="YAHOO UPDATE"
      footerDisclosure={
        <>
          You are receiving this because Yahoo is connected to your Flaim
          account. <FlaimFooterLink href={unsubscribeUrl}>Unsubscribe</FlaimFooterLink>.
        </>
      }
      headerUrl={withEmailRef(emailBrand.url, campaign)}
      preview="I know Yahoo access has been frustrating. Here is where things stand."
      title="A quick Yahoo update"
    >
      <FlaimText>Hey everyone,</FlaimText>
      <FlaimText>
        If you connected Yahoo to Flaim recently, you have probably run into
        the same problem: Yahoo has not yet restored Flaim&apos;s Fantasy Sports
        API access. Until that happens, Flaim cannot finish syncing your Yahoo
        leagues.
      </FlaimText>
      <FlaimText>
        I know how frustrating that is, especially with football season getting
        close. I use Yahoo too, and I feel the pain. I am continuing to work
        through Yahoo&apos;s approval process and will restore the connection as
        soon as they allow it.
      </FlaimText>
      <FlaimText>
        You do not need to reconnect or keep retrying. Your Flaim account is
        still here. I will send another short note when Yahoo access is working
        again.
      </FlaimText>
      <FlaimText>Thanks for hanging in there and for giving Flaim a try.</FlaimText>
      <FlaimText>Gerry</FlaimText>
    </FlaimEmailLayout>
  );
}

YahooAccessBroadcastEmail.PreviewProps = {
  unsubscribeUrl: "{{{RESEND_UNSUBSCRIBE_URL}}}",
} satisfies YahooAccessBroadcastEmailProps;
