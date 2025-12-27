"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Shield, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';

interface OAuthParams {
  redirectUri: string;
  state?: string;
  scope?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  clientId?: string;
}

interface ConsentScreenProps {
  oauthParams: OAuthParams;
  onAllow: () => Promise<void>;
  onDeny: () => void;
  hasLeaguesConfigured: boolean;
}

export default function ConsentScreen({
  oauthParams,
  onAllow,
  onDeny,
  hasLeaguesConfigured
}: ConsentScreenProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAllow = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onAllow();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authorize. Please try again.');
      setIsLoading(false);
    }
  };

  // Show warning if no leagues are configured
  if (!hasLeaguesConfigured) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-yellow-100 dark:bg-yellow-900/20 flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
          </div>
          <CardTitle>Setup Required</CardTitle>
          <CardDescription>
            You need to configure at least one ESPN league before connecting Claude.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No leagues configured</AlertTitle>
            <AlertDescription>
              Claude needs access to your fantasy league data. Please complete the ESPN setup first.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onDeny}>
            Cancel
          </Button>
          <Button className="flex-1" asChild>
            <Link href="/">Go to Setup</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Shield className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>Authorize Claude</CardTitle>
        <CardDescription>
          Claude is requesting access to your FLAIM account
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* App info */}
        <div className="p-4 bg-muted rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-background border flex items-center justify-center text-lg font-bold">
              C
            </div>
            <div>
              <div className="font-medium">Claude by Anthropic</div>
              <div className="text-sm text-muted-foreground">AI Assistant</div>
            </div>
          </div>
        </div>

        {/* Permissions */}
        <div className="space-y-2">
          <div className="text-sm font-medium">Claude will be able to:</div>
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span>View your ESPN fantasy league information</span>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span>Access your team rosters and matchups</span>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span>View league standings and statistics</span>
            </div>
          </div>
        </div>

        {/* Scope badge */}
        {oauthParams.scope && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Scope:</span>
            <Badge variant="secondary">{oauthParams.scope}</Badge>
          </div>
        )}

        {/* Error display */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Security note */}
        <p className="text-xs text-muted-foreground text-center">
          You can revoke this access anytime from your{' '}
          <a href="/connectors" className="underline hover:text-foreground">
            Connectors settings
          </a>
          .
        </p>
      </CardContent>

      <CardFooter className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={onDeny}
          disabled={isLoading}
        >
          Deny
        </Button>
        <Button
          className="flex-1"
          onClick={handleAllow}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Authorizing...
            </>
          ) : (
            'Allow'
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
