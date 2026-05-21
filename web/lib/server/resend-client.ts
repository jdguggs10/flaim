import "server-only";
import { Resend } from "resend";

type ResendApiError = {
  message?: string;
};

let resend: Resend | null = null;
let resendApiKey: string | null = null;
let resendContacts: Resend | null = null;
let resendContactsApiKey: string | null = null;

export function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  if (!resend || resendApiKey !== apiKey) {
    resend = new Resend(apiKey);
    resendApiKey = apiKey;
  }

  return resend;
}

export function getResendContactsClient() {
  const apiKey = process.env.RESEND_CONTACTS_API_KEY ?? process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  if (!resendContacts || resendContactsApiKey !== apiKey) {
    resendContacts = new Resend(apiKey);
    resendContactsApiKey = apiKey;
  }

  return resendContacts;
}

export function getResendErrorMessage(error: ResendApiError | unknown) {
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
