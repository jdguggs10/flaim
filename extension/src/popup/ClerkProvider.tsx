/**
 * Clerk Provider for Extension Popup
 * ---------------------------------------------------------------------------
 * Wraps the extension popup with ClerkProvider configured for Sync Host.
 * Session syncs automatically from flaim.app when user is signed in there.
 */

import { ClerkProvider } from '@clerk/chrome-extension';
import { ReactNode } from 'react';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const SYNC_HOST = import.meta.env.VITE_CLERK_SYNC_HOST as string;

if (!PUBLISHABLE_KEY) {
  throw new Error(
    'Missing VITE_CLERK_PUBLISHABLE_KEY environment variable. ' +
      'Copy extension/.env.example to extension/.env.development and fill in your Clerk key.'
  );
}

interface Props {
  children: ReactNode;
}

export function ExtensionClerkProvider({ children }: Props) {
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      syncHost={SYNC_HOST}
      afterSignOutUrl="/"
    >
      {children}
    </ClerkProvider>
  );
}
