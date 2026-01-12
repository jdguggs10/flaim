'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Chrome, Check, Loader2, Monitor, LogIn } from 'lucide-react';
import { pingExtension, isChromeBrowser, type ExtensionPingResult } from '@/lib/extension-ping';

type Status =
  | 'loading'
  | 'signed_out'
  | 'connected' // Ping successful + signed in via Clerk
  | 'installed_not_signed_in' // Ping successful but not signed in
  | 'not_installed' // Ping failed or not Chrome, no credentials
  | 'server_only' // Non-Chrome browser with credentials
  | 'non_chrome'; // Non-Chrome browser without credentials

interface StepSyncEspnProps {
  className?: string;
}

export function StepSyncEspn({ className }: StepSyncEspnProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!isSignedIn) {
      setStatus('signed_out');
      return;
    }

    const checkConnection = async () => {
      const isChrome = isChromeBrowser();

      // Try to ping extension (only works in Chrome)
      let ping: ExtensionPingResult | null = null;
      if (isChrome) {
        try {
          ping = await pingExtension(1500);
        } catch {
          ping = null;
        }
      }

      // Check server status for credentials (non-Chrome fallback)
      let serverHasCredentials = false;
      try {
        const response = await fetch('/api/extension/connection');
        if (response.ok) {
          const data = (await response.json()) as { connected?: boolean };
          serverHasCredentials = !!data.connected;
        }
      } catch {
        // Silently fail
      }

      // Determine status based on browser type and ping result
      if (ping?.reachable) {
        // Extension responded - use ping as source of truth
        if (ping.signedIn) {
          setStatus('connected');
        } else {
          setStatus('installed_not_signed_in');
        }
      } else if (!isChrome) {
        // Non-Chrome browser - show server data with disclaimer
        if (serverHasCredentials) {
          setStatus('server_only');
        } else {
          setStatus('non_chrome');
        }
      } else {
        // Chrome but couldn't reach extension
        setStatus('not_installed');
      }
    };

    checkConnection();
  }, [isLoaded, isSignedIn]);

  // Base card structure
  const renderCard = (content: React.ReactNode) => (
    <div className={`bg-background rounded-xl p-6 border flex flex-col ${className ?? ''}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
          2
        </div>
        <h3 className="font-semibold text-lg">Sync Credentials</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-2 flex-1">
        The Chrome extension grabs your ESPN credentials automatically.
      </p>
      {content}
    </div>
  );

  // Loading state
  if (!isLoaded || status === 'loading') {
    return renderCard(
      <Button className="w-full" variant="outline" disabled>
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Checking...
      </Button>
    );
  }

  // Signed out
  if (status === 'signed_out') {
    return renderCard(
      <Button className="w-full" variant="outline" disabled>
        <Chrome className="h-4 w-4 mr-2" />
        Sign in first
      </Button>
    );
  }

  // Connected - extension installed and signed in
  if (status === 'connected') {
    return renderCard(
      <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
        <Check className="h-4 w-4" />
        Extension connected
      </div>
    );
  }

  // Installed but not signed in via Clerk
  if (status === 'installed_not_signed_in') {
    return renderCard(
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-amber-600">
          <LogIn className="h-4 w-4" />
          <span>Sign in required</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Session will sync automatically. Try reopening the extension.
        </p>
      </div>
    );
  }

  // Server only - non-Chrome browser with credentials synced
  if (status === 'server_only') {
    return renderCard(
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-green-600">
          <Check className="h-4 w-4" />
          <span>ESPN credentials synced</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Viewing from non-Chrome browser. Extension available in Chrome.
        </p>
      </div>
    );
  }

  // Non-Chrome browser without credentials
  if (status === 'non_chrome') {
    return renderCard(
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <Monitor className="h-4 w-4" />
          <span>Chrome required</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Open this page in Chrome to install the extension.
        </p>
      </div>
    );
  }

  // Not installed - default
  return renderCard(
    <a
      href="https://chromewebstore.google.com/detail/flaim/ogkkejmgkoolfaidplldmcghbikpmonn"
      target="_blank"
      rel="noopener noreferrer"
    >
      <Button className="w-full" variant="outline">
        <Chrome className="h-4 w-4 mr-2" />
        Install Extension
      </Button>
    </a>
  );
}
