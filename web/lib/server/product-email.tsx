import "server-only";
import * as React from "react";
import { emailBrand } from "@/emails/brand";
import EspnSetupLinkEmail from "@/emails/espn-setup-link";
import LeagueConnectedEmail from "@/emails/league-connected";
import WelcomeEmail from "@/emails/welcome";
import { logEmailOps } from "@/lib/server/email-ops";
import { getResendClient, getResendErrorMessage } from "@/lib/server/resend-client";

type ProductEmailTemplate = "welcome" | "league-connected" | "espn-setup-link";

interface ProductEmailResult {
  id?: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

interface SendProductEmailParams {
  eventType: string;
  react: React.ReactElement;
  subject: string;
  template: ProductEmailTemplate;
  to: string;
  userId: string;
}

interface SendWelcomeEmailParams {
  firstName?: string;
  leaguesUrl: string;
  to: string;
  unsubscribeUrl: string;
  userId: string;
}

interface SendLeagueConnectedEmailParams {
  aiDocsUrl: string;
  leagueName?: string;
  platform?: string;
  to: string;
  unsubscribeUrl: string;
  userId: string;
}

interface SendEspnSetupLinkEmailParams {
  extensionUrl: string;
  leaguesUrl: string;
  to: string;
  userId: string;
}

function isProductEmailEnabled() {
  return process.env.FLAIM_EMAILS_ENABLED === "true";
}

async function sendProductEmail({
  eventType,
  react,
  subject,
  template,
  to,
  userId,
}: SendProductEmailParams): Promise<ProductEmailResult> {
  if (!isProductEmailEnabled()) {
    return { ok: false, skipped: true, error: "Product email sending is disabled" };
  }

  const client = getResendClient();
  if (!client) {
    return { ok: false, skipped: true, error: "RESEND_API_KEY is not configured" };
  }

  try {
    const { data, error } = await client.emails.send(
      {
        from: emailBrand.senders.product,
        react,
        replyTo: emailBrand.senders.replyTo,
        subject,
        tags: [{ name: "template", value: template }],
        to,
      },
      { idempotencyKey: `${eventType}/${userId}` },
    );

    if (error) {
      const message = getResendErrorMessage(error);
      logEmailOps("email.send_failed", {
        error: message,
        provider: "resend",
        reason: "resend_email_send_failed",
        source: `product.${template}`,
        userId,
      });
      return { ok: false, error: message };
    }

    return { ok: true, id: data?.id };
  } catch (error) {
    const message = getResendErrorMessage(error);
    logEmailOps("email.send_failed", {
      error: message,
      provider: "resend",
      reason: "resend_email_send_failed",
      source: `product.${template}`,
      userId,
    });
    return { ok: false, error: message };
  }
}

export function sendWelcomeEmail({
  firstName,
  leaguesUrl,
  to,
  unsubscribeUrl,
  userId,
}: SendWelcomeEmailParams) {
  return sendProductEmail({
    eventType: "welcome",
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
    userId,
  });
}

export function sendLeagueConnectedEmail({
  aiDocsUrl,
  leagueName,
  platform,
  to,
  unsubscribeUrl,
  userId,
}: SendLeagueConnectedEmailParams) {
  const resolvedLeagueName = leagueName || "Your league";

  return sendProductEmail({
    eventType: "league-connected",
    react: (
      <LeagueConnectedEmail
        aiDocsUrl={aiDocsUrl}
        leagueName={resolvedLeagueName}
        platform={platform}
        unsubscribeUrl={unsubscribeUrl}
      />
    ),
    subject: `${resolvedLeagueName} is ready in Flaim`,
    template: "league-connected",
    to,
    userId,
  });
}

export function sendEspnSetupLinkEmail({
  extensionUrl,
  leaguesUrl,
  to,
  userId,
}: SendEspnSetupLinkEmailParams) {
  return sendProductEmail({
    eventType: "espn-setup-link",
    react: (
      <EspnSetupLinkEmail extensionUrl={extensionUrl} leaguesUrl={leaguesUrl} />
    ),
    subject: "Your ESPN setup link for Flaim",
    template: "espn-setup-link",
    to,
    userId,
  });
}
