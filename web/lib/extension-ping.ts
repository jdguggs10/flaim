/**
 * Extension Ping Utility - Clerk Auth Version
 * ---------------------------------------------------------------------------
 * Pings the Flaim Chrome extension directly using chrome.runtime.sendMessage
 * to verify it's installed and check if user is signed in via Clerk.
 *
 * This uses the externally_connectable API - the extension must declare
 * the website's origin in its manifest.json.
 */

// Type declarations for chrome.runtime (avoids @types/chrome dependency)
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage: (
          extensionId: string,
          message: unknown,
          callback: (response: unknown) => void
        ) => void;
        lastError?: { message?: string };
      };
    };
  }
}

/**
 * Get extension IDs to try.
 * Supports multiple IDs for dev/prod via NEXT_PUBLIC_EXTENSION_IDS env var.
 * Format: comma-separated list of extension IDs
 * Example: "ogkkejmgkoolfaidplldmcghbikpmonn,abcdefghijklmnopqrstuvwxyz123456"
 */
function getExtensionIds(): string[] {
  const envIds = process.env.NEXT_PUBLIC_EXTENSION_IDS;
  if (envIds) {
    return envIds
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }
  // Fallback to production CWS ID
  return ['mbnokejgglkfgkeeenolgdpcnfakpbkn'];
}

export interface ExtensionPingResult {
  /** Whether the ping was successful (extension responded) */
  reachable: boolean;
  /** Whether the user is signed in (Clerk session active) */
  signedIn: boolean;
  /** Clerk user ID if signed in */
  userId: string | null;
  /** Error message if ping failed */
  error?: string;
}

/**
 * Response from extension background script ping.
 * New Clerk-based format (v1.3.0+)
 */
export interface ExtensionPingResponse {
  installed: true;
  signedIn: boolean;
  userId: string | null;
}

/**
 * Check if the current browser supports extension messaging.
 * Uses window.chrome for type safety.
 */
export function canPingExtension(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.chrome !== 'undefined' &&
    typeof window.chrome.runtime !== 'undefined' &&
    typeof window.chrome.runtime.sendMessage === 'function'
  );
}

/**
 * Check if we're likely in a Chrome browser (for UI hints).
 * Note: This is a heuristic and not 100% reliable.
 */
export function isChromeBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Chrome but not Edge, Opera, or other Chromium browsers that don't support our extension
  return /Chrome/.test(ua) && !/Edg|OPR|Opera/.test(ua);
}

/**
 * Ping a single extension ID
 */
function pingExtensionId(extensionId: string, timeoutMs: number): Promise<ExtensionPingResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        reachable: false,
        signedIn: false,
        userId: null,
        error: 'Extension did not respond (timeout)',
      });
    }, timeoutMs);

    try {
      window.chrome!.runtime!.sendMessage(extensionId, { type: 'ping' }, (response: unknown) => {
        clearTimeout(timeout);

        // Check for Chrome runtime errors
        const lastError = window.chrome?.runtime?.lastError;
        if (lastError) {
          resolve({
            reachable: false,
            signedIn: false,
            userId: null,
            error: lastError.message || 'Extension not reachable',
          });
          return;
        }

        // Validate response
        const typedResponse = response as ExtensionPingResponse | undefined;
        if (typedResponse && typedResponse.installed) {
          resolve({
            reachable: true,
            signedIn: typedResponse.signedIn ?? false,
            userId: typedResponse.userId ?? null,
          });
        } else {
          resolve({
            reachable: false,
            signedIn: false,
            userId: null,
            error: 'Invalid response from extension',
          });
        }
      });
    } catch (err) {
      clearTimeout(timeout);
      resolve({
        reachable: false,
        signedIn: false,
        userId: null,
        error: err instanceof Error ? err.message : 'Failed to ping extension',
      });
    }
  });
}

/**
 * Ping the extension to check if it's installed and user is signed in.
 * Tries multiple extension IDs (for dev/prod support) until one responds.
 *
 * @param timeoutMs - How long to wait for each ID (default 1500ms)
 */
export async function pingExtension(timeoutMs = 1500): Promise<ExtensionPingResult> {
  // Check if chrome.runtime is available
  if (!canPingExtension()) {
    return {
      reachable: false,
      signedIn: false,
      userId: null,
      error: 'Browser does not support extension messaging',
    };
  }

  const extensionIds = getExtensionIds();

  // Try each extension ID until one responds
  for (const extensionId of extensionIds) {
    const result = await pingExtensionId(extensionId, timeoutMs);
    if (result.reachable) {
      return result;
    }
  }

  // None of the IDs responded
  return {
    reachable: false,
    signedIn: false,
    userId: null,
    error: 'Extension not reachable',
  };
}
