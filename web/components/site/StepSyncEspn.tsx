'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Chrome, Check, Loader2, AlertTriangle, Monitor } from 'lucide-react';
import {
  pingExtension,
  isChromeBrowser,
  type ExtensionPingResult,
} from '@/lib/extension-ping';

type Status =
  | 'loading'
  | 'signed_out'
  | 'connected'           // Ping successful + paired
  | 'installed_not_paired' // Ping successful but not paired
  | 'not_installed'       // Ping failed or not Chrome, no server record
  | 'needs_attention'     // Chrome: ping failed but server has record
  | 'server_only'         // Non-Chrome browser with server record
  | 'non_chrome';         // Non-Chrome browser without server record

interface ServerToken {
  lastUsedAt: string | null;
}

export function StepSyncEspn() {
  const { isLoaded, isSignedIn } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [serverToken, setServerToken] = useState<ServerToken | null>(null);

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

      // Check server status
      let serverConnected = false;
      let token: ServerToken | null = null;
      try {
        const response = await fetch('/api/extension/connection');
        if (response.ok) {
          const data = await response.json() as {
            connected?: boolean;
            token?: { lastUsedAt: string | null } | null;
          };
          serverConnected = !!data.connected;
          if (data.token) {
            token = { lastUsedAt: data.token.lastUsedAt };
            setServerToken(token);
          }
        }
      } catch {
        // Silently fail
      }

      // Determine status based on browser type and ping result
      if (ping?.reachable) {
        // Extension responded - use ping as source of truth
        if (ping.paired) {
          setStatus('connected');
        } else {
          setStatus('installed_not_paired');
        }
      } else if (!isChrome) {
        // Non-Chrome browser - show server data with disclaimer
        if (serverConnected) {
          setStatus('server_only');
        } else {
          setStatus('non_chrome');
        }
      } else {
        // Chrome but couldn't reach extension
        if (serverConnected) {
          setStatus('needs_attention');
        } else {
          setStatus('not_installed');
        }
      }
    };

    checkConnection();
  }, [isLoaded, isSignedIn]);

  // Format date for display
  const formatLastActivity = (dateStr: string | null) => {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Base card structure
  const renderCard = (content: React.ReactNode) => (
    <div className="bg-background rounded-xl p-6 border flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
          2
        </div>
        <h3 className="font-semibold text-lg">Sync ESPN Data</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-2 flex-1">
        The Chrome extension grabs your ESPN credentials automatically.
      </p>
      <p className="text-xs text-muted-foreground mb-4">
        Or enter them manually if you prefer.
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

  // Connected - verified via ping
  if (status === 'connected') {
    return renderCard(
      <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
        <Check className="h-4 w-4" />
        Extension connected
      </div>
    );
  }

  // Installed but not paired
  if (status === 'installed_not_paired') {
    return renderCard(
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-amber-600">
          <AlertTriangle className="h-4 w-4" />
          <span>Not paired</span>
        </div>
        <Link href="/extension">
          <Button className="w-full" variant="outline">
            <Chrome className="h-4 w-4 mr-2" />
            Pair Extension
          </Button>
        </Link>
      </div>
    );
  }

  // Needs attention - Chrome but ping failed, server has record
  if (status === 'needs_attention') {
    return renderCard(
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-amber-600">
          <AlertTriangle className="h-4 w-4" />
          <span>May need re-pair</span>
        </div>
        <Link href="/extension">
          <Button className="w-full" variant="outline">
            <Chrome className="h-4 w-4 mr-2" />
            Check Status
          </Button>
        </Link>
      </div>
    );
  }

  // Server only - non-Chrome browser with server record
  if (status === 'server_only') {
    return renderCard(
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <Monitor className="h-4 w-4" />
          <span>Chrome extension active</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Last activity: {formatLastActivity(serverToken?.lastUsedAt ?? null)}
        </p>
      </div>
    );
  }

  // Non-Chrome browser without a server record
  if (status === 'non_chrome') {
    return renderCard(
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <Monitor className="h-4 w-4" />
          <span>Chrome required</span>
        </div>
        <p className="text-xs text-muted-foreground">
          The extension only works in Chrome on desktop. Open this page in Chrome to install and pair it.
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
