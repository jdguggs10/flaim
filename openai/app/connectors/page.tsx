"use client";

import React, { useEffect, useState } from 'react';
import { useAuth, SignIn } from '@clerk/nextjs';
import ClaudeConnectionCard from '@/components/connectors/ClaudeConnectionCard';
import ConnectInstructions from '@/components/connectors/ConnectInstructions';
import { Loader2, Plug, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  resource?: string;
}

export default function ConnectorsPage() {
  const { isLoaded, isSignedIn } = useAuth();
  
  const [isConnected, setIsConnected] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Check connection status
  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setIsCheckingStatus(false);
      return;
    }

    const checkStatus = async () => {
      try {
        const response = await fetch('/api/oauth/status');
        if (response.ok) {
          const data = await response.json() as {
            hasConnection?: boolean;
            connections?: Connection[];
          };
          setIsConnected(!!data.hasConnection);
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
    };

    checkStatus();
  }, [isLoaded, isSignedIn]);

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
              Sign in to connect your FLAIM account to AI assistants like Claude or ChatGPT.
            </p>
          </div>
          <SignIn routing="hash" fallbackRedirectUrl="/connectors" />
        </div>
      </div>
    );
  }

  // Disconnect handler
  const handleDisconnect = async () => {
    const response = await fetch('/api/oauth/revoke-all', {
      method: 'POST',
    });

    if (!response.ok) {
      const err = await response.json() as { error?: string };
      setErrorMessage(err.error || 'Failed to disconnect');
      return;
    }

    setIsConnected(false);
    setConnections([]);
    setErrorMessage(null);
    setShowSuccess(true);
    // Hide success message after 5 seconds
    setTimeout(() => setShowSuccess(false), 5000);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Plug className="h-6 w-6" />
            <h1 className="text-2xl font-semibold">Connectors</h1>
          </div>
          <p className="text-muted-foreground">
            Connect your FLAIM account to AI assistants to access your fantasy sports data.
          </p>
        </div>

        {/* Status Alerts */}
        {statusError && (
          <Alert variant="destructive">
            <AlertTitle>Status unavailable</AlertTitle>
            <AlertDescription>{statusError}</AlertDescription>
          </Alert>
        )}
        {errorMessage && (
          <Alert variant="destructive">
            <AlertTitle>Disconnect failed</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        {showSuccess && (
          <Alert className="bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>
            Connector access has been revoked successfully.
          </AlertDescription>
        </Alert>
        )}

        {/* Claude Connection Card */}
        <ClaudeConnectionCard
          isConnected={isConnected}
          onDisconnect={handleDisconnect}
        />

        {/* Active Connections Table */}
        {connections.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Active Connections</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connections.map((conn, index) => (
                    <TableRow key={`${conn.id}-${conn.expiresAt ?? ''}-${index}`}>
                      <TableCell>{conn.resource || 'MCP Client'}</TableCell>
                      <TableCell className="text-muted-foreground">{conn.scope}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {conn.expiresAt ? new Date(conn.expiresAt).toLocaleDateString() : 'Unknown'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Setup Instructions */}
        <ConnectInstructions />

        {/* Info about data access */}
        <div className="text-sm text-muted-foreground space-y-2 pt-4 border-t">
          <p>
            <strong>How it works:</strong> When you connect Claude or ChatGPT, the assistant can access your ESPN fantasy
            league data through FLAIM. Your ESPN credentials are stored securely and never shared
            with the assistant directly.
          </p>
          <p>
            <strong>Privacy:</strong> Assistants only see the fantasy data you authorize (league info,
            rosters, matchups). Your ESPN login cookies remain encrypted in FLAIM.
          </p>
        </div>
      </div>
    </div>
  );
}
