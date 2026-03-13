/**
 * Background Service Worker - Clerk Auth Version
 * ---------------------------------------------------------------------------
 * Handles external messages from the Flaim website to verify extension status.
 * Uses Clerk session instead of custom tokens.
 */

import { createClerkClient } from '@clerk/chrome-extension/background';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const SYNC_HOST = import.meta.env.VITE_CLERK_SYNC_HOST as string;

// Initialize Clerk client for background script (returns a promise per Clerk docs)
const clerkClientPromise = createClerkClient({
  publishableKey: PUBLISHABLE_KEY,
  syncHost: SYNC_HOST,
});

/**
 * Get current Clerk auth state
 */
const getClerkState = async (): Promise<{ signedIn: boolean; userId: string | null }> => {
  try {
    const clerk = await clerkClientPromise;
    const token = clerk.session ? await clerk.session.getToken() : null;
    return {
      signedIn: !!token,
      userId: clerk.user?.id || null,
    };
  } catch {
    return { signedIn: false, userId: null };
  }
};

// Message types
interface PingMessage {
  type: 'ping';
}

interface PingResponse {
  installed: true;
  signedIn: boolean;
  userId: string | null;
}

type ExternalMessage = PingMessage;

// Allowed origins for external messages (defense-in-depth; also enforced by manifest).
// Built dynamically so preview builds (VITE_SITE_BASE) are included automatically.
const ALLOWED_ORIGINS: string[] = ['https://flaim.app', 'http://localhost:3000'];
const siteBase = import.meta.env.VITE_SITE_BASE as string | undefined;
if (siteBase) {
  try {
    const origin = new URL(siteBase).origin;
    if (!ALLOWED_ORIGINS.includes(origin)) ALLOWED_ORIGINS.push(origin);
  } catch { /* ignore invalid VITE_SITE_BASE */ }
}

/**
 * Handle messages from external web pages (flaim.app, localhost:3000)
 * Configured via externally_connectable in manifest.json
 */
chrome.runtime.onMessageExternal.addListener(
  (
    message: ExternalMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: PingResponse) => void
  ) => {
    if (!sender.origin || !ALLOWED_ORIGINS.includes(sender.origin)) {
      return false;
    }

    if (message?.type === 'ping') {
      // Check Clerk session state
      getClerkState()
        .then(({ signedIn, userId }) => {
          sendResponse({
            installed: true,
            signedIn,
            userId,
          });
        })
        .catch(() => {
          sendResponse({
            installed: true,
            signedIn: false,
            userId: null,
          });
        });

      // Return true to indicate async response
      return true;
    }

    return false;
  }
);

