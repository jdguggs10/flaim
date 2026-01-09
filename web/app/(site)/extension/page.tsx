"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth, SignIn } from '@clerk/nextjs';
import {
  Loader2,
  Puzzle,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  Monitor,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  pingExtension,
  isChromeBrowser,
} from '@/lib/extension-ping';
import { EspnCredentialsCard } from '@/components/site/EspnCredentialsCard';
import { useEspnCredentials } from '@/lib/use-espn-credentials';

interface ExtensionToken {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
  name?: string | null;
}

type ConnectionStatus =
  | 'loading'
  | 'connected'           // Ping successful + paired
  | 'installed_not_paired' // Ping successful but not paired
  | 'not_installed'       // Ping failed, no server record
  | 'needs_repair'        // Ping failed, but server has record (stale)
  | 'server_only';        // Non-Chrome browser, showing server data

export default function ExtensionPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const espnCredentials = useEspnCredentials();

  // Connection state
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('loading');
  const [activeToken, setActiveToken] = useState<ExtensionToken | null>(null);

  // Pairing code state
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<Date | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Check connection status - ping extension first, then fall back to server
  const checkStatus = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);

    // Detect if we're in Chrome
    const isChrome = isChromeBrowser();

    // Try to ping the extension directly (only works in Chrome)
    let ping: { reachable: boolean; paired: boolean } | null = null;
    if (isChrome) {
      try {
        ping = await pingExtension(1500);
      } catch {
        ping = null;
      }
    }

    // Fetch server-side status regardless (for fallback data)
    let serverConnected = false;
    let serverToken: ExtensionToken | null = null;

    try {
      const response = await fetch('/api/extension/connection');
      if (response.ok) {
        const data = await response.json() as {
          connected?: boolean;
          token?: ExtensionToken | null;
        };
        serverConnected = !!data.connected;
        serverToken = data.token || null;
        setActiveToken(serverToken);
      }
    } catch (err) {
      console.error('Failed to fetch server status:', err);
    }

    // Determine connection status based on ping and server data
    if (ping?.reachable) {
      // Extension responded - use ping as source of truth
      if (ping.paired) {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('installed_not_paired');
      }
    } else if (!isChrome) {
      // Non-Chrome browser - show server data with disclaimer
      if (serverConnected) {
        setConnectionStatus('server_only');
      } else {
        setConnectionStatus('not_installed');
      }
    } else {
      // Chrome but couldn't reach extension
      if (serverConnected) {
        // Server thinks we're connected but extension isn't reachable
        setConnectionStatus('needs_repair');
      } else {
        setConnectionStatus('not_installed');
      }
    }

    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      return;
    }
    checkStatus();
  }, [isLoaded, isSignedIn, checkStatus]);

  // Generate pairing code
  const handleGenerateCode = async () => {
    setIsGeneratingCode(true);
    setError(null);
    setPairingCode(null);

    try {
      const response = await fetch('/api/extension/code', {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json() as {
          code?: string;
          expiresAt?: string;
        };
        setPairingCode(data.code || null);
        setCodeExpiresAt(data.expiresAt ? new Date(data.expiresAt) : null);
      } else {
        const err = await response.json() as { error?: string; error_description?: string };
        setError(err.error_description || err.error || 'Failed to generate code');
      }
    } catch (err) {
      console.error('Failed to generate code:', err);
      setError('Failed to generate pairing code. Please try again.');
    } finally {
      setIsGeneratingCode(false);
    }
  };

  // Copy code to clipboard
  const handleCopyCode = async () => {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Disconnect extension (revoke server token)
  const handleDisconnect = async () => {
    if (!activeToken) return;

    setIsDisconnecting(true);
    setError(null);

    try {
      const response = await fetch('/api/extension/token', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId: activeToken.id }),
      });

      if (response.ok) {
        setActiveToken(null);
        setConnectionStatus('not_installed');
        setSuccessMessage('Extension disconnected successfully.');
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        const err = await response.json() as { error?: string; error_description?: string };
        setError(err.error_description || err.error || 'Failed to disconnect');
      }
    } catch (err) {
      console.error('Failed to disconnect:', err);
      setError('Failed to disconnect extension. Please try again.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Format date for display
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Calculate time remaining for pairing code
  const getTimeRemaining = () => {
    if (!codeExpiresAt) return null;
    const now = new Date();
    const diff = codeExpiresAt.getTime() - now.getTime();
    if (diff <= 0) return 'Expired';
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Get status badge variant and text
  const getStatusBadge = () => {
    switch (connectionStatus) {
      case 'connected':
        return { variant: 'default' as const, icon: CheckCircle2, text: 'Connected' };
      case 'installed_not_paired':
        return { variant: 'secondary' as const, icon: AlertTriangle, text: 'Not Paired' };
      case 'needs_repair':
        return { variant: 'destructive' as const, icon: AlertTriangle, text: 'Needs Re-pair' };
      case 'server_only':
        return { variant: 'secondary' as const, icon: Monitor, text: 'Server Record' };
      default:
        return { variant: 'secondary' as const, icon: XCircle, text: 'Not Connected' };
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

  // Not signed in
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

  // Loading state (signed in, awaiting status)
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

        {/* Success/Error Alerts */}
        {successMessage && (
          <Alert className="bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Success</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

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
            {/* Connected - real-time verified */}
            {connectionStatus === 'connected' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Extension is connected and working</span>
                </div>
                {activeToken && (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Connected since</p>
                      <p className="font-medium">{formatDate(activeToken.createdAt)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Last activity</p>
                      <p className="font-medium">{formatDate(activeToken.lastUsedAt)}</p>
                    </div>
                    {activeToken.name && (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Connected on</p>
                        <p className="font-medium">{activeToken.name}</p>
                        <p className="text-xs text-muted-foreground">Shown after pairing or re-pairing.</p>
                      </div>
                    )}
                  </div>
                )}
                <Button
                  variant="destructive"
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="w-full sm:w-auto"
                >
                  {isDisconnecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Disconnecting...
                    </>
                  ) : (
                    'Disconnect Extension'
                  )}
                </Button>
              </div>
            )}

            {/* Installed but not paired */}
            {connectionStatus === 'installed_not_paired' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Extension is installed but not paired to your account</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Generate a pairing code below and enter it in the extension popup.
                </p>
              </div>
            )}

            {/* Needs re-pair - server has record but extension not reachable */}
            {connectionStatus === 'needs_repair' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Extension may need to be re-paired</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  We couldn&apos;t reach your extension. If the extension popup shows &quot;Not Connected&quot;,
                  generate a new pairing code below.
                </p>
                {activeToken && (
                  <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                    <p>Last known activity: {formatDate(activeToken.lastUsedAt)}</p>
                    <p>Originally paired: {formatDate(activeToken.createdAt)}</p>
                    {activeToken.name && <p>Connected on: {activeToken.name}</p>}
                  </div>
                )}
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  size="sm"
                >
                  Clear old connection
                </Button>
              </div>
            )}

            {/* Server only - non-Chrome browser */}
            {connectionStatus === 'server_only' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-blue-600">
                  <Monitor className="h-4 w-4" />
                  <span>Viewing from a non-Chrome browser</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  The extension is only available in Chrome. Here&apos;s what we know from the server:
                </p>
                {activeToken && (
                  <div className="text-sm bg-muted p-3 rounded-lg space-y-1">
                    <p><span className="text-muted-foreground">Connected since:</span> {formatDate(activeToken.createdAt)}</p>
                    <p><span className="text-muted-foreground">Last activity:</span> {formatDate(activeToken.lastUsedAt)}</p>
                    {activeToken.name && (
                      <p><span className="text-muted-foreground">Connected on:</span> {activeToken.name}</p>
                    )}
                  </div>
                )}
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  size="sm"
                >
                  Disconnect Extension
                </Button>
              </div>
            )}

            {/* Not installed */}
            {connectionStatus === 'not_installed' && (
              <div className="space-y-3">
                <p className="text-muted-foreground">
                  No extension connected. Install the extension and then generate a pairing code below.
                </p>
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
            )}

            {/* Pairing Code */}
            <div className="border-t pt-4 space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Pairing Code</p>
                <p className="text-sm text-muted-foreground">
                  Generate a code and enter it in the extension popup.
                </p>
              </div>
              {pairingCode ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 bg-muted rounded-lg p-4 text-center">
                      <p className="text-4xl font-mono font-bold tracking-widest">{pairingCode}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopyCode}
                      title="Copy code"
                    >
                      {codeCopied ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Expires in: <span className="font-mono">{getTimeRemaining()}</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleGenerateCode}
                      disabled={isGeneratingCode}
                    >
                      <RefreshCw className={`h-4 w-4 mr-1 ${isGeneratingCode ? 'animate-spin' : ''}`} />
                      New Code
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={handleGenerateCode}
                  disabled={isGeneratingCode}
                  className="w-full sm:w-auto"
                >
                  {isGeneratingCode ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    'Generate Pairing Code'
                  )}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Pairing a new extension will disconnect the previous one.
              </p>
            </div>
          </CardContent>
        </Card>

        <EspnCredentialsCard credentials={espnCredentials} />
      </div>
    </div>
  );
}
