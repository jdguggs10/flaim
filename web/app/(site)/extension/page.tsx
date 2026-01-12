"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth, SignIn } from '@clerk/nextjs';
import {
  Loader2,
  Puzzle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Monitor,
  LogIn,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { pingExtension, isChromeBrowser } from '@/lib/extension-ping';
import { EspnCredentialsCard } from '@/components/site/EspnCredentialsCard';
import { useEspnCredentials } from '@/lib/use-espn-credentials';

type ConnectionStatus =
  | 'loading'
  | 'signed_in' // Extension installed + signed in via Clerk
  | 'installed_not_signed_in' // Extension installed but not signed in
  | 'not_installed' // Extension not reachable
  | 'non_chrome'; // Not a Chrome browser

export default function ExtensionPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const espnCredentials = useEspnCredentials();

  // Connection state
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('loading');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Check connection status by pinging extension
  const checkStatus = useCallback(async () => {
    setIsRefreshing(true);

    // Detect if we're in Chrome
    const isChrome = isChromeBrowser();

    if (!isChrome) {
      setConnectionStatus('non_chrome');
      setIsRefreshing(false);
      return;
    }

    // Ping the extension
    try {
      const ping = await pingExtension(2000);

      if (ping.reachable) {
        if (ping.signedIn) {
          setConnectionStatus('signed_in');
        } else {
          setConnectionStatus('installed_not_signed_in');
        }
      } else {
        setConnectionStatus('not_installed');
      }
    } catch (err) {
      console.error('Failed to ping extension:', err);
      setConnectionStatus('not_installed');
    }

    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      return;
    }
    checkStatus();
  }, [isLoaded, isSignedIn, checkStatus]);

  // Get status badge variant and text
  const getStatusBadge = () => {
    switch (connectionStatus) {
      case 'signed_in':
        return { variant: 'default' as const, icon: CheckCircle2, text: 'Connected' };
      case 'installed_not_signed_in':
        return { variant: 'secondary' as const, icon: LogIn, text: 'Sign In Required' };
      case 'non_chrome':
        return { variant: 'secondary' as const, icon: Monitor, text: 'Chrome Only' };
      default:
        return { variant: 'secondary' as const, icon: XCircle, text: 'Not Installed' };
    }
  };

  // Loading state
  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not signed in to website
  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold">Sign in to use the extension</h1>
            <p className="text-muted-foreground">
              Sign in to connect the Flaim Chrome extension to your account.
            </p>
          </div>
          <SignIn routing="hash" fallbackRedirectUrl="/extension" />
        </div>
      </div>
    );
  }

  // Loading extension status
  if (connectionStatus === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statusBadge = getStatusBadge();
  const StatusIcon = statusBadge.icon;

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Puzzle className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Chrome Extension</h1>
          </div>
          <p className="text-muted-foreground">
            The Flaim Chrome extension automatically captures your ESPN credentials,
            so you don&apos;t have to dig through browser settings.
          </p>
        </div>

        {/* Chrome Web Store Link */}
        <div>
          <Button variant="outline" asChild className="w-full sm:w-auto">
            <a
              href="https://chromewebstore.google.com/detail/flaim/ogkkejmgkoolfaidplldmcghbikpmonn"
              target="_blank"
              rel="noopener noreferrer"
            >
              Chrome Web Store
            </a>
          </Button>
        </div>

        {/* Connection Status Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Connection Status</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={statusBadge.variant}>
                  <StatusIcon className="h-3 w-3 mr-1" />
                  {statusBadge.text}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={checkStatus}
                  disabled={isRefreshing}
                  title="Refresh status"
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Signed In - Extension connected */}
            {connectionStatus === 'signed_in' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Extension is connected and signed in</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Open the extension popup to sync your ESPN credentials or manage your leagues.
                </p>
              </div>
            )}

            {/* Installed but not signed in */}
            {connectionStatus === 'installed_not_signed_in' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-amber-600">
                  <LogIn className="h-4 w-4" />
                  <span>Extension is installed but not signed in</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Your sign-in session will automatically sync to the extension.
                  If the extension still shows &quot;Not Signed In&quot;, try closing and reopening the extension popup.
                </p>
              </div>
            )}

            {/* Not installed */}
            {connectionStatus === 'not_installed' && (
              <div className="space-y-3">
                <p className="text-muted-foreground">
                  Install the Flaim Chrome extension to automatically capture your ESPN credentials.
                </p>
                <Button variant="outline" asChild className="w-full sm:w-auto">
                  <a
                    href="https://chromewebstore.google.com/detail/flaim/ogkkejmgkoolfaidplldmcghbikpmonn"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Install from Chrome Web Store
                  </a>
                </Button>
              </div>
            )}

            {/* Non-Chrome browser */}
            {connectionStatus === 'non_chrome' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-blue-600">
                  <Monitor className="h-4 w-4" />
                  <span>Chrome browser required</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  The Flaim extension is only available for Chrome. Open this page in Chrome
                  to install and use the extension.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ESPN Credentials Card */}
        <EspnCredentialsCard credentials={espnCredentials} />

        {/* How It Works */}
        <Card>
          <CardHeader>
            <CardTitle>How It Works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              <strong>1. Install the extension</strong> from the Chrome Web Store.
            </p>
            <p>
              <strong>2. Sign in to flaim.app</strong> - your session automatically syncs to the extension.
            </p>
            <p>
              <strong>3. Log into ESPN</strong> (espn.com/fantasy) in any tab.
            </p>
            <p>
              <strong>4. Click the extension</strong> and tap &quot;Sync to Flaim&quot; to capture your ESPN credentials.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
