import "server-only";
import type {
  AddContactSegmentOptions,
  CreateContactOptions,
  UpdateContactOptions,
} from "resend";
import {
  getResendContactsClient,
  getResendErrorMessage,
} from "@/lib/server/resend-client";

type ClerkEmailAddress = {
  email_address?: string | null;
  id?: string | null;
  verification?: {
    status?: string | null;
  } | null;
};

export type ClerkUserEmailSyncPayload = {
  email_addresses?: ClerkEmailAddress[] | null;
  first_name?: string | null;
  id: string;
  last_name?: string | null;
  primary_email_address_id?: string | null;
};

type ContactSyncAction = "created" | "updated";

export interface ContactSyncResult {
  action?: ContactSyncAction;
  email?: string;
  error?: string;
  ok: boolean;
  skipped?: boolean;
}

type ContactApiError = {
  message?: string;
  name?: string;
  statusCode?: number | null;
};

type ContactApiResponse<T> =
  | { data: T; error: null }
  | { data: null; error: ContactApiError };

interface ContactSyncClient {
  contacts: {
    create: (payload: CreateContactOptions) => Promise<ContactApiResponse<{ id: string }>>;
    segments: {
      add: (payload: AddContactSegmentOptions) => Promise<ContactApiResponse<{ id: string }>>;
    };
    update: (payload: UpdateContactOptions) => Promise<ContactApiResponse<{ id: string }>>;
  };
}

interface SyncClerkUserOptions {
  client?: ContactSyncClient;
  enabled?: boolean;
  segmentId?: string;
}

function cleanString(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned || null;
}

function isNotFound(error: ContactApiError) {
  return error.statusCode === 404 || error.name === "not_found";
}

function isAlreadyInSegment(error: ContactApiError) {
  return /already.*segment/i.test(error.message ?? "") || error.statusCode === 409;
}

function isContactSyncEnabled(options: SyncClerkUserOptions) {
  return options.enabled ?? process.env.RESEND_CONTACT_SYNC_ENABLED === "true";
}

export function getClerkUserPrimaryEmail(user: ClerkUserEmailSyncPayload) {
  return cleanString(getClerkUserPrimaryEmailAddress(user)?.email_address)?.toLowerCase() ?? null;
}

export function getClerkUserProductEmail(
  user: ClerkUserEmailSyncPayload,
): { email: string; ok: true } | { error: string; ok: false; skipped: true } {
  const email = getClerkUserPrimaryEmail(user);
  if (!email) {
    return { ok: false, skipped: true, error: "Clerk user has no email address" };
  }

  const primaryEmailAddress = getClerkUserPrimaryEmailAddress(user);
  if (hasExplicitUnverifiedStatus(primaryEmailAddress)) {
    return { ok: false, skipped: true, error: "Clerk user primary email is not verified" };
  }

  return { ok: true, email };
}

function hasExplicitUnverifiedStatus(emailAddress: ClerkEmailAddress | null | undefined) {
  // Missing verification status is common for OAuth-backed users; only skip explicit failures.
  const status = cleanString(emailAddress?.verification?.status);
  return Boolean(status && status !== "verified");
}

// Keep primary email selection aligned with web/scripts/backfill-resend-contacts.mjs.
function getClerkUserPrimaryEmailAddress(user: ClerkUserEmailSyncPayload) {
  const emailAddresses = user.email_addresses ?? [];
  if (emailAddresses.length === 1) {
    return emailAddresses[0];
  }

  return (
    emailAddresses.find((email) => email.id === user.primary_email_address_id) ??
    null
  );
}

async function ensureContactSegment(
  client: ContactSyncClient,
  email: string,
  segmentId: string,
) {
  const { error } = await client.contacts.segments.add({ email, segmentId });

  if (!error || isAlreadyInSegment(error)) {
    return null;
  }

  return getResendErrorMessage(error);
}

export async function syncClerkUserToResendContact(
  user: ClerkUserEmailSyncPayload,
  options: SyncClerkUserOptions = {},
): Promise<ContactSyncResult> {
  if (!isContactSyncEnabled(options)) {
    return { ok: false, skipped: true, error: "Resend contact sync is disabled" };
  }

  const emailResult = getClerkUserProductEmail(user);
  if (!emailResult.ok) {
    return emailResult;
  }

  const client = options.client ?? getResendContactsClient();
  if (!client) {
    return { ok: false, error: "RESEND_CONTACTS_API_KEY is not configured" };
  }

  const firstName = cleanString(user.first_name);
  const lastName = cleanString(user.last_name);
  const email = emailResult.email;
  const segmentId = cleanString(options.segmentId ?? process.env.RESEND_CONTACT_SEGMENT_ID);

  try {
    const updated = await client.contacts.update({
      email,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
    });

    if (updated.error) {
      if (!isNotFound(updated.error)) {
        return { ok: false, email, error: getResendErrorMessage(updated.error) };
      }

      const payload: CreateContactOptions = {
        email,
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        unsubscribed: false,
      };

      if (segmentId) {
        payload.segments = [{ id: segmentId }];
      }

      const created = await client.contacts.create(payload);
      if (created.error) {
        return { ok: false, email, error: getResendErrorMessage(created.error) };
      }

      return { ok: true, action: "created", email };
    }

    if (segmentId) {
      const segmentError = await ensureContactSegment(client, email, segmentId);
      if (segmentError) {
        return { ok: false, email, error: segmentError };
      }
    }

    return { ok: true, action: "updated", email };
  } catch (error) {
    return { ok: false, email, error: getResendErrorMessage(error) };
  }
}
