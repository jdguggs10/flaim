"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';
import { Shield, CheckCircle, Loader2, AlertCircle } from 'lucide-react';

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
}

export function getConsentContent(scope?: string): {
  description: string;
  permissions: string[];
} {
  const scopes = new Set((scope || 'mcp:read').trim().split(/\s+/).filter(Boolean));

  if (scopes.has('mcp:write')) {
    return {
      description: 'Your AI app is requesting access to read fantasy data and refresh your Flaim league list',
      permissions: [
        'View your fantasy league data',
        'Refresh may add or update Flaim\'s connected-league records, including newly available seasons and renamed leagues',
        'Provider access remains read-only - cannot change teams on ESPN, Yahoo, or Sleeper',
      ],
    };
  }

  return {
    description: 'Your AI app is requesting read-only access to your Flaim account',
    permissions: [
      'View your fantasy league data',
      'Access rosters, matchups, standings, and more',
      'Read-only access - cannot modify your teams or Flaim league list',
    ],
  };
}

export default function ConsentScreen({
  oauthParams,
  onAllow,
  onDeny,
}: ConsentScreenProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consentContent = getConsentContent(oauthParams.scope);

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

  // Note: We no longer gate on league configuration.
  // If user has no leagues/teams, tools will return helpful errors when called.

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Shield className="h-6 w-6 text-primary" />
        </div>
        <CardTitle>Authorize Flaim Access</CardTitle>
        <CardDescription>
          {consentContent.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* App info */}
        <div className="p-4 bg-muted rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Image src="/flaim-mark-hero.png" alt="Flaim" width={24} height={24} className="dark:hidden" />
              <Image src="/flaim-mark-hero-dark.png" alt="Flaim" width={24} height={24} className="hidden dark:block" />
            </div>
            <div>
              <div className="font-medium">Flaim Fantasy</div>
            </div>
          </div>
        </div>

        {/* Permissions */}
        <div className="space-y-2">
          <div className="text-sm font-medium">The assistant will be able to:</div>
          <div className="space-y-2">
            {consentContent.permissions.map((permission) => (
              <div key={permission} className="flex items-start gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-success mt-0.5 shrink-0" />
                <span>{permission}</span>
              </div>
            ))}
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
        <div className="space-y-2 text-center text-xs text-muted-foreground">
          <p>
            New account? After authorizing, open My Leagues to connect ESPN,
            Yahoo, or Sleeper before asking your assistant for league advice.
          </p>
          <p>
            You can revoke this access anytime from your AI app&apos;s integration settings.
          </p>
        </div>
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
