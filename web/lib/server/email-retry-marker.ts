import "server-only";
import { clerkClient } from "@clerk/nextjs/server";

export const EMAIL_RETRY_METADATA_KEY = "flaim_email_ops";

export type EmailRetryKind = "contactSync" | "welcomeEvent";

type RetryMarker = {
  failedAt: string;
};

type RetryMetadata = Partial<Record<EmailRetryKind, RetryMarker>>;

type ClerkMetadataClient = {
  users: {
    updateUserMetadata: (
      userId: string,
      params: {
        privateMetadata: Record<string, unknown>;
      },
    ) => Promise<unknown>;
  };
};

interface RetryMarkerOptions {
  client?: ClerkMetadataClient;
  metadata?: unknown;
  now?: Date;
}

function getRetryMetadata(metadata: unknown): RetryMetadata | null {
  if (typeof metadata !== "object" || metadata === null) return null;

  const value = (metadata as Record<string, unknown>)[EMAIL_RETRY_METADATA_KEY];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  return value as RetryMetadata;
}

export function hasEmailRetryMarker(metadata: unknown, kind: EmailRetryKind) {
  const marker = getRetryMetadata(metadata)?.[kind];
  return typeof marker === "object" && marker !== null;
}

async function getClient(client?: ClerkMetadataClient) {
  return client ?? ((await clerkClient()) as ClerkMetadataClient);
}

/**
 * `updateUserMetadata` performs a deep merge. Supplying only this marker leaves
 * unrelated private metadata and the other retry marker intact. A marker that
 * is already present must remain untouched so its own user.updated webhook
 * cannot renew it forever on an ongoing Resend outage.
 */
export async function markEmailRetry(
  userId: string,
  kind: EmailRetryKind,
  options: RetryMarkerOptions = {},
) {
  if (hasEmailRetryMarker(options.metadata, kind)) {
    return { ok: true, skipped: true } as const;
  }

  try {
    const client = await getClient(options.client);
    await client.users.updateUserMetadata(userId, {
      privateMetadata: {
        [EMAIL_RETRY_METADATA_KEY]: {
          [kind]: {
            failedAt: (options.now ?? new Date()).toISOString(),
          },
        },
      },
    });
    return { ok: true, skipped: false } as const;
  } catch (error) {
    return { ok: false, error } as const;
  }
}

/**
 * Clear only the retry which just completed. Passing null to Clerk's deep-merge
 * metadata endpoint removes that nested key while retaining other metadata.
 */
export async function clearEmailRetry(
  userId: string,
  kind: EmailRetryKind,
  options: RetryMarkerOptions = {},
) {
  if (!hasEmailRetryMarker(options.metadata, kind)) {
    return { ok: true, skipped: true } as const;
  }

  try {
    const client = await getClient(options.client);
    await client.users.updateUserMetadata(userId, {
      privateMetadata: {
        [EMAIL_RETRY_METADATA_KEY]: {
          [kind]: null,
        },
      },
    });
    return { ok: true, skipped: false } as const;
  } catch (error) {
    return { ok: false, error } as const;
  }
}
