"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth, SignIn } from '@clerk/nextjs';
import PlatformCard from '@/components/site/connectors/PlatformCard';
import McpUrlsCard from '@/components/site/connectors/McpUrlsCard';
import { Loader2, Plug, CheckCircle2, RefreshCw, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Connection {
  id: string;
  expiresAt: string;
  scope: string;
  clientName?: string;
}

// Platform configurations
const platforms = [
  {
    name: 'Claude',
    icon: 'C',
    gradient: 'bg-gradient-to-br from-orange-400 to-orange-600',
    description: 'Anthropic',
    setupGuideUrl: 'https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp',
    setupGuideLabel: 'Claude Setup Guide',
    enabled: true,
  },
  {
    name: 'ChatGPT',
    icon: 'G',
    gradient: 'bg-gradient-to-br from-green-400 to-green-600',
    description: 'OpenAI',
    setupGuideUrl: 'https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta',
    setupGuideLabel: 'ChatGPT Setup Guide',
    enabled: true,
  },
  {
    name: 'Gemini',
    icon: 'G',
    gradient: 'bg-gradient-to-br from-blue-400 to-blue-600',
    description: 'Google',
    setupGuideUrl: undefined,
    setupGuideLabel: undefined,
    enabled: false,
  },
];

export default function ConnectorsPage() {
  const { isLoaded, isSignedIn } = useAuth();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [revokingConnectionId, setRevokingConnectionId] = useState<string | null>(null);

  // Helper to check if a platform has an active connection
  const isPlatformConnected = (platformName: string) => {
    return connections.some(conn => conn.clientName === platformName);
  };

  // Check connection status
  const checkStatus = useCallback(async () => {
    setIsCheckingStatus(true);
    try {
      const response = await fetch('/api/oauth/status');
      if (response.ok) {
        const data = await response.json() as {
          hasConnection?: boolean;
          connections?: Connection[];
        };
        setConnections(data.connections || []);
        setStatusError(null);
      } else {
        setStatusError('Failed to check connection status.');
      }
    } catch (err) {
      console.error('Failed to check status:', err);
      setStatusError('Failed to check connection status.');
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
            <h1 className="text-2xl font-semibold">Sign in to manage connectors</h1>
            <p className="text-muted-foreground">
              Sign in to connect your Flaim account to AI assistants like Claude or ChatGPT.
            </p>
          </div>
          <SignIn routing="hash" fallbackRedirectUrl="/connectors" />
        </div>
      </div>
    );
  }

  // Disconnect all handler
  const handleDisconnectAll = async () => {
    setIsDisconnecting(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/oauth/revoke-all', {
        method: 'POST',
      });

      if (!response.ok) {
        const err = await response.json() as { error?: string };
        setErrorMessage(err.error || 'Failed to disconnect');
        return;
      }

      setConnections([]);
      setSuccessMessage('All connections have been revoked successfully.');
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 5000);
    } catch {
      setErrorMessage('Failed to disconnect. Please try again.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Revoke single connection handler
  const handleRevokeConnection = async (connectionId: string, clientName: string) => {
    setRevokingConnectionId(connectionId);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/oauth/revoke-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId: connectionId }),
      });

      if (!response.ok) {
        const err = await response.json() as { error?: string };
        setErrorMessage(err.error || 'Failed to revoke connection');
        return;
      }

      setConnections(prev => prev.filter(c => c.id !== connectionId));
      setSuccessMessage(`${clientName} connection has been revoked.`);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 5000);
    } catch {
      setErrorMessage('Failed to revoke connection. Please try again.');
    } finally {
      setRevokingConnectionId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Plug className="h-6 w-6" />
            <h1 className="text-2xl font-semibold">Connectors</h1>
          </div>
          <p className="text-muted-foreground">
            Connect your Flaim account to AI assistants to access your fantasy sports data.
          </p>
        </div>

        {/* Status Alerts */}
        {statusError && (
          <Alert variant="destructive">
            <AlertTitle>Status unavailable</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>{statusError}</span>
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
            </AlertDescription>
          </Alert>
        )}
        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        {showSuccess && (
          <Alert className="bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            <AlertTitle>Success</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {/* MCP URLs */}
        <McpUrlsCard />

        {/* Platform Cards */}
        <div>
          <h2 className="text-lg font-semibold mb-3">AI Platforms</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {platforms.map((platform) => (
              <PlatformCard
                key={platform.name}
                {...platform}
                isConnected={platform.enabled && isPlatformConnected(platform.name)}
              />
            ))}
          </div>
        </div>

        {/* Active Connections Table */}
        {connections.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Active Connections</CardTitle>
              {connections.length > 1 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDisconnectAll}
                  disabled={isDisconnecting}
                >
                  {isDisconnecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Disconnecting...
                    </>
                  ) : (
                    'Disconnect All'
                  )}
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Platform</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.map((conn) => (
                    <TableRow key={conn.id}>
                      <TableCell className="font-medium">{conn.clientName || 'MCP Client'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {conn.expiresAt ? new Date(conn.expiresAt).toLocaleDateString() : 'Unknown'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeConnection(conn.id, conn.clientName || 'MCP Client')}
                          disabled={revokingConnectionId === conn.id}
                          className="h-8 px-2 text-muted-foreground hover:text-destructive"
                        >
                          {revokingConnectionId === conn.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <X className="h-4 w-4" />
                          )}
                          <span className="ml-1">Revoke</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Info about data access */}
        <div className="text-sm text-muted-foreground space-y-2 pt-4 border-t">
          <p>
            <strong>How it works:</strong> Copy an MCP URL above, then follow your AI platform&apos;s
            setup guide to add it as a connector. You&apos;ll be redirected to Flaim to authorize access.
          </p>
          <p>
            <strong>Privacy:</strong> Your ESPN credentials are stored securely in Flaim and never
            shared with AI assistants directly. They only see your fantasy data (leagues, rosters, matchups).
          </p>
        </div>
      </div>
    </div>
  );
}
