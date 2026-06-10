import * as React from "react";
import {
  FlaimEmailLayout,
  FlaimFooterLink,
  FlaimText,
} from "./components/FlaimEmailLayout";
import emailLinks from "./flaim-email-links.json";

interface WelcomeEmailProps {
  chatGptAppUrl?: string;
  firstName?: string;
  leaguesUrl?: string;
  /** Must be a real unsubscribe or notification-preferences URL before connecting to a live sender. */
  unsubscribeUrl?: string;
}

function WelcomeSetupPath({
  chatGptAppUrl,
  leaguesUrl,
}: {
  chatGptAppUrl: string;
  leaguesUrl: string;
}) {
  return (
    <div
      style={{
        backgroundColor: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        margin: "8px 0 20px",
        padding: "16px",
      }}
    >
      <p style={{ color: "#030712", fontSize: "14px", fontWeight: "700", lineHeight: "22px", margin: "0 0 12px" }}>
        Finish your setup
      </p>
      <table cellPadding="0" cellSpacing="0" role="presentation" style={{ marginBottom: "10px", width: "100%" }}>
        <tbody>
          <tr>
            <td style={{ padding: "0", verticalAlign: "middle", width: "33.333%" }}>
              <div style={{ backgroundColor: "#22c55e", borderRadius: "999px 0 0 999px", height: "6px", width: "100%" }} />
            </td>
            <td style={{ padding: "0", verticalAlign: "middle", width: "33.333%" }}>
              <div style={{ backgroundColor: "#e5e7eb", height: "6px", width: "100%" }} />
            </td>
            <td style={{ padding: "0", verticalAlign: "middle", width: "33.333%" }}>
              <div style={{ backgroundColor: "#e5e7eb", borderRadius: "0 999px 999px 0", height: "6px", width: "100%" }} />
            </td>
          </tr>
        </tbody>
      </table>
      <table cellPadding="0" cellSpacing="0" role="presentation" style={{ width: "100%" }}>
        <tbody>
          <tr>
            <td style={{ padding: "0 6px 0 0", verticalAlign: "top", width: "33.333%" }}>
              <p style={{ color: "#166534", fontSize: "11px", fontWeight: "700", lineHeight: "16px", margin: "0", textTransform: "uppercase" }}>
                Done
              </p>
              <p style={{ color: "#166534", fontSize: "12px", fontWeight: "700", lineHeight: "17px", margin: "2px 0 0" }}>
                Create account
              </p>
            </td>
            <td style={{ padding: "0 6px", verticalAlign: "top", width: "33.333%" }}>
              <p style={{ color: "#030712", fontSize: "11px", fontWeight: "700", lineHeight: "16px", margin: "0", textTransform: "uppercase" }}>
                Next
              </p>
              <a
                href={leaguesUrl}
                style={{
                  color: "#030712",
                  fontSize: "12px",
                  fontWeight: "700",
                  lineHeight: "17px",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
              >
                Connect a league →
              </a>
            </td>
            <td style={{ padding: "0 0 0 6px", verticalAlign: "top", width: "33.333%" }}>
              <p style={{ color: "#6b7280", fontSize: "11px", fontWeight: "700", lineHeight: "16px", margin: "0", textTransform: "uppercase" }}>
                Then
              </p>
              <a
                href={chatGptAppUrl}
                style={{
                  color: "#6b7280",
                  fontSize: "12px",
                  fontWeight: "700",
                  lineHeight: "17px",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }}
              >
                Open in ChatGPT →
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function WelcomeEmail({
  chatGptAppUrl = emailLinks.chatGptAppUrl,
  firstName = "Alex",
  leaguesUrl = emailLinks.leaguesUrl,
  unsubscribeUrl = "mailto:support@flaim.app?subject=Unsubscribe%20from%20Flaim%20product%20updates",
}: WelcomeEmailProps) {
  return (
    <FlaimEmailLayout
      eyebrow="WELCOME"
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
        Flaim lets you ask fantasy questions using your actual, real league
        data. Once connected, you can ask about waiver adds, trade grades,
        roster decisions, and so much more.
      </FlaimText>
      <WelcomeSetupPath chatGptAppUrl={chatGptAppUrl} leaguesUrl={leaguesUrl} />
      <p
        style={{
          borderTop: "1px solid #e5e7eb",
          color: "#6b7280",
          fontSize: "13px",
          lineHeight: "21px",
          margin: "22px 0 0",
          paddingTop: "16px",
        }}
      >
        Flaim is read-only. It can access your league data, but it cannot set
        lineups, drop players, make trades, or change league settings.
      </p>
    </FlaimEmailLayout>
  );
}

WelcomeEmail.PreviewProps = {
  chatGptAppUrl: emailLinks.chatGptAppUrl,
  firstName: "Alex",
  leaguesUrl: emailLinks.leaguesUrl,
  unsubscribeUrl:
    "mailto:support@flaim.app?subject=Unsubscribe%20from%20Flaim%20product%20updates",
} satisfies WelcomeEmailProps;
