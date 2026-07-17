import "server-only";
import * as React from "react";
import { emailBrand } from "@/emails/brand";
import EspnSetupLinkEmail from "@/emails/espn-setup-link";
import LeagueConnectedEmail from "@/emails/league-connected";
import WelcomeEmail from "@/emails/welcome";
import { getResendClient, getResendErrorMessage } from "@/lib/server/resend-client";

type ProductEmailTemplate = "welcome" | "league-connected" | "espn-setup-link";

interface ProductEmailResult {
  id?: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

interface SendProductEmailParams {
  react: React.ReactElement;
  subject: string;
  template: ProductEmailTemplate;
  to: string;
}

interface SendWelcomeEmailParams {
  firstName?: string;
  leaguesUrl: string;
  to: string;
  unsubscribeUrl: string;
}

interface SendLeagueConnectedEmailParams {
  aiGuideUrl: string;
  leagueName?: string;
  platform?: string;
  to: string;
  unsubscribeUrl: string;
}

interface SendEspnSetupLinkEmailParams {
  extensionUrl: string;
  leaguesUrl: string;
  to: string;
}

function isProductEmailEnabled() {
  return process.env.FLAIM_EMAILS_ENABLED === "true";
}

async function sendProductEmail({
  react,
  subject,
  template,
  to,
}: SendProductEmailParams): Promise<ProductEmailResult> {
  if (!isProductEmailEnabled()) {
    return { ok: false, skipped: true, error: "Product email sending is disabled" };
  }

  const client = getResendClient();
  if (!client) {
    return { ok: false, skipped: true, error: "RESEND_API_KEY is not configured" };
  }

  try {
    const { data, error } = await client.emails.send({
      from: emailBrand.senders.product,
      react,
      replyTo: emailBrand.senders.replyTo,
      subject,
      tags: [{ name: "template", value: template }],
      to,
    });

    if (error) {
      const message = getResendErrorMessage(error);
      console.error(`Resend ${template} email failed:`, message);
      return { ok: false, error: message };
    }

    return { ok: true, id: data?.id };
  } catch (error) {
    const message = getResendErrorMessage(error);
    console.error(`Resend ${template} email failed:`, message);
    return { ok: false, error: message };
  }
}

export function sendWelcomeEmail({
  firstName,
  leaguesUrl,
  to,
  unsubscribeUrl,
}: SendWelcomeEmailParams) {
  return sendProductEmail({
    react: (
      <WelcomeEmail
        firstName={firstName}
        leaguesUrl={leaguesUrl}
        unsubscribeUrl={unsubscribeUrl}
      />
    ),
    subject: "Welcome to Flaim",
    template: "welcome",
    to,
  });
}

export function sendLeagueConnectedEmail({
  aiGuideUrl,
  leagueName,
  platform,
  to,
  unsubscribeUrl,
}: SendLeagueConnectedEmailParams) {
  const resolvedLeagueName = leagueName || "Your league";

  return sendProductEmail({
    react: (
      <LeagueConnectedEmail
        aiGuideUrl={aiGuideUrl}
        leagueName={resolvedLeagueName}
        platform={platform}
        unsubscribeUrl={unsubscribeUrl}
      />
    ),
    subject: `${resolvedLeagueName} is ready in Flaim`,
    template: "league-connected",
    to,
  });
}

export function sendEspnSetupLinkEmail({
  extensionUrl,
  leaguesUrl,
  to,
}: SendEspnSetupLinkEmailParams) {
  return sendProductEmail({
    react: (
      <EspnSetupLinkEmail extensionUrl={extensionUrl} leaguesUrl={leaguesUrl} />
    ),
    subject: "Your ESPN setup link for Flaim",
    template: "espn-setup-link",
    to,
  });
}
