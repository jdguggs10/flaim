import * as React from "react";
import {
  FlaimButton,
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
      footerDisclosure={
        <>
          You are receiving this because Yahoo is connected to your Flaim
          account. <FlaimFooterLink href={unsubscribeUrl}>Unsubscribe</FlaimFooterLink>.
        </>
      }
      headerUrl={withEmailRef(emailBrand.url, campaign)}
      preview="Yahoo access is still unavailable, and I still do not have an ETA."
      title="Yahoo Update"
    >
      <FlaimText>
        Unfortunately, Yahoo access is still unavailable. Yahoo told us the new
        approval process would take 1-2 weeks. It&apos;s been more than a month,
        and I have no ETA.
      </FlaimText>
      <FlaimText>
        In late-July, Yahoo deactivated everyone&apos;s Fantasy Sports API access
        without warning and directed us to apply again through a new process. I
        did so immediately. After some hopeful progress during the first few
        weeks, it&apos;s been radio silence ever since.
      </FlaimText>
      <FlaimText>
        I&apos;m pulling every string I can think of to get Flaim&apos;s access
        restored. If anyone has a contact at Yahoo who might be able to help,
        I&apos;d be all ears. This wait is... very frustrating.
      </FlaimText>
      <FlaimText>I&apos;ll update you as soon as anything changes.</FlaimText>
      <FlaimText>Gerry</FlaimText>
      <FlaimButton href={withEmailRef(`${emailBrand.url}/leagues`, campaign)}>
        Manage ESPN &amp; Sleeper leagues
      </FlaimButton>
    </FlaimEmailLayout>
  );
}

YahooAccessBroadcastEmail.PreviewProps = {
  unsubscribeUrl: "{{{RESEND_UNSUBSCRIBE_URL}}}",
} satisfies YahooAccessBroadcastEmailProps;
