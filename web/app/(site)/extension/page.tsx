"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth, SignIn } from '@clerk/nextjs';
import { Loader2, Puzzle, Copy, Check, CheckCircle2, XCircle, ExternalLink, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ExtensionToken {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function ExtensionPage() {
  const { isLoaded, isSignedIn } = useAuth();

  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [activeToken, setActiveToken] = useState<ExtensionToken | null>(null);

  // Pairing code state
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<Date | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [errorRetriable, setErrorRetriable] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showDevInstructions, setShowDevInstructions] = useState(false);
  const [showFaq, setShowFaq] = useState(false);

  // Check connection status
  const checkStatus = useCallback(async () => {
    setIsCheckingStatus(true);
    try {
      const response = await fetch('/api/extension/connection');
      if (response.ok) {
        const data = await response.json() as {
          connected?: boolean;
          token?: ExtensionToken | null;
        };
        setIsConnected(!!data.connected);
        setActiveToken(data.token || null);
        setError(null);
        setErrorRetriable(false);
      } else {
        setError('Failed to check connection status.');
        setErrorRetriable(true);
      }
    } catch (err) {
      console.error('Failed to check status:', err);
      setError('Failed to check connection status.');
      setErrorRetriable(true);
    } finally {
      setIsCheckingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setIsCheckingStatus(false);
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

  // Disconnect extension
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
        setIsConnected(false);
        setActiveToken(null);
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

  // Calculate time remaining
  const getTimeRemaining = () => {
    if (!codeExpiresAt) return null;
    const now = new Date();
    const diff = codeExpiresAt.getTime() - now.getTime();
    if (diff <= 0) return 'Expired';
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Loading state
  if (!isLoaded || isCheckingStatus) {
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
            <AlertDescription className="flex items-center justify-between">
              <span>{error}</span>
              {errorRetriable && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkStatus}
                  disabled={isCheckingStatus}
                  className="ml-4"
                >
                  {isCheckingStatus ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span className="ml-1">Retry</span>
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Connection Status Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Connection Status</CardTitle>
              <Badge variant={isConnected ? 'default' : 'secondary'}>
                {isConnected ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Connected
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3 mr-1" />
                    Not Connected
                  </>
                )}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isConnected && activeToken ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Connected since</p>
                    <p className="font-medium">{formatDate(activeToken.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Last used</p>
                    <p className="font-medium">{formatDate(activeToken.lastUsedAt)}</p>
                  </div>
                </div>
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
            ) : (
              <p className="text-muted-foreground">
                No extension connected. Follow the steps below to pair your extension.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Install Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>Step 1: Install Extension</CardTitle>
            <CardDescription>
              Get the Flaim extension from the Chrome Web Store
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" asChild className="w-full sm:w-auto">
              <a
                href="https://chrome.google.com/webstore/detail/flaim"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Chrome Web Store
              </a>
            </Button>
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowDevInstructions(!showDevInstructions)}
            >
              {showDevInstructions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Developer instructions
            </button>
            {showDevInstructions && (
              <div className="text-sm text-muted-foreground space-y-2 pl-5">
                <ol className="list-decimal list-inside space-y-1">
                  <li>Go to <code className="bg-muted px-1 rounded">chrome://extensions</code></li>
                  <li>Enable &quot;Developer mode&quot; (top right)</li>
                  <li>Click &quot;Load unpacked&quot; and select <code className="bg-muted px-1 rounded">extension/dist</code></li>
                </ol>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pairing Code */}
        <Card>
          <CardHeader>
            <CardTitle>Step 2: Pair Extension</CardTitle>
            <CardDescription>
              Generate a pairing code and enter it in the extension popup
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>

        {/* Next Steps */}
        <Card>
          <CardHeader>
            <CardTitle>Step 3: Sync Credentials</CardTitle>
            <CardDescription>
              Once paired, the extension can capture your ESPN credentials
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Make sure you&apos;re logged into <a href="https://www.espn.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ESPN.com</a></li>
              <li>Click the Flaim extension icon in your browser toolbar</li>
              <li>Click &quot;Sync to Flaim&quot; in the extension popup</li>
              <li>Your ESPN credentials will be saved automatically</li>
            </ol>
            <p className="text-sm text-muted-foreground">
              After syncing, go to the <a href="/leagues" className="text-primary hover:underline">Leagues page</a> to add your fantasy leagues.
            </p>
          </CardContent>
        </Card>

        {/* FAQ */}
        <Card>
          <CardHeader className="cursor-pointer" onClick={() => setShowFaq(!showFaq)}>
            <div className="flex items-center justify-between">
              <CardTitle>Frequently Asked Questions</CardTitle>
              {showFaq ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
            </div>
          </CardHeader>
          {showFaq && (
            <CardContent className="space-y-4">
              <div>
                <p className="font-medium">Why do I need an extension?</p>
                <p className="text-sm text-muted-foreground">
                  ESPN uses secure cookies for authentication. The extension can read these cookies
                  directly from your browser, avoiding the manual process of finding them in DevTools.
                </p>
              </div>
              <div>
                <p className="font-medium">Is this safe?</p>
                <p className="text-sm text-muted-foreground">
                  Yes. The extension only reads ESPN cookies and sends them to Flaim over HTTPS.
                  Your credentials are stored securely and never shared with third parties.
                </p>
              </div>
              <div>
                <p className="font-medium">What if I use multiple browsers?</p>
                <p className="text-sm text-muted-foreground">
                  You can install the extension on multiple browsers, but only one can be connected
                  at a time. Pairing a new extension will disconnect the previous one.
                </p>
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
