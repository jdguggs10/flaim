import "server-only";
import * as React from "react";
import { Resend } from "resend";
import { emailBrand } from "@/emails/brand";
import LeagueConnectedEmail from "@/emails/league-connected";
import WelcomeEmail from "@/emails/welcome";

type ProductEmailTemplate = "welcome" | "league-connected";

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

let resend: Resend | null = null;
let resendApiKey: string | null = null;

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  if (!resend || resendApiKey !== apiKey) {
    resend = new Resend(apiKey);
    resendApiKey = apiKey;
  }

  return resend;
}

function isProductEmailEnabled() {
  return process.env.FLAIM_EMAILS_ENABLED === "true";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "Unknown Resend error";
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
      const message = getErrorMessage(error);
      console.error(`Resend ${template} email failed:`, message);
      return { ok: false, error: message };
    }

    return { ok: true, id: data?.id };
  } catch (error) {
    const message = getErrorMessage(error);
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
