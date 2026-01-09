/**
 * Background Service Worker
 * ---------------------------------------------------------------------------
 * Handles external messages from the Flaim website to verify extension status.
 * Uses chrome.runtime.onMessageExternal for web page → extension communication.
 */

import { getToken } from './lib/storage';

// Message types
interface PingMessage {
  type: 'ping';
}

interface PingResponse {
  installed: true;
  paired: boolean;
  hasToken: boolean;
}

type ExternalMessage = PingMessage;

/**
 * Handle messages from external web pages (flaim.app, localhost:3000)
 * Configured via externally_connectable in manifest.json
 */
chrome.runtime.onMessageExternal.addListener(
  (
    message: ExternalMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: PingResponse) => void
  ) => {
    if (message?.type === 'ping') {
      // Check if we have a stored token
      getToken()
        .then((token) => {
          const response: PingResponse = {
            installed: true,
            paired: !!token,
            hasToken: !!token,
          };
          sendResponse(response);
        })
        .catch(() => {
          // If getToken() fails, respond with paired: false to avoid timeout
          sendResponse({
            installed: true,
            paired: false,
            hasToken: false,
          });
        });

      // Return true to indicate we'll call sendResponse asynchronously
      return true;
    }

    // Unknown message type
    return false;
  }
);

// Log when service worker starts (helpful for debugging)
console.log('[Flaim] Background service worker started');
