"use client";

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth, SignIn } from '@clerk/nextjs';
import ConsentScreen from '@/components/connectors/ConsentScreen';
import { Loader2 } from 'lucide-react';

interface LeagueData {
  leagueId: string;
  sport: string;
  teamId?: string;
}

function LoadingFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function OAuthConsentContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();

  const [isCheckingLeagues, setIsCheckingLeagues] = useState(true);
  const [hasLeaguesConfigured, setHasLeaguesConfigured] = useState(false);

  // Extract OAuth params from URL
  const oauthParams = {
    redirectUri: searchParams.get('redirect_uri') || '',
    state: searchParams.get('state') || undefined,
    scope: searchParams.get('scope') || 'mcp:read',
    codeChallenge: searchParams.get('code_challenge') || undefined,
    codeChallengeMethod: searchParams.get('code_challenge_method') || 'S256',
    clientId: searchParams.get('client_id') || undefined,
  };

  // Validate required params
  const isValidRequest = oauthParams.redirectUri && oauthParams.codeChallenge;

  // Check if user has leagues configured
  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setIsCheckingLeagues(false);
      return;
    }

    const checkLeagues = async () => {
      try {
        const response = await fetch('/api/onboarding/espn/leagues');
        if (response.ok) {
          const data = await response.json() as { leagues?: LeagueData[] };
          const leagues = data.leagues || [];
          // Check if at least one league has a teamId set
          const hasConfigured = leagues.some((l: LeagueData) => l.teamId);
          setHasLeaguesConfigured(hasConfigured);
        } else {
          setHasLeaguesConfigured(false);
        }
      } catch (err) {
        console.error('Failed to check leagues:', err);
        setHasLeaguesConfigured(false);
      } finally {
        setIsCheckingLeagues(false);
      }
    };

    checkLeagues();
  }, [isLoaded, isSignedIn]);

  // Handle "Allow" - create auth code and redirect to Claude
  const handleAllow = async () => {
    try {
      const response = await fetch('/api/oauth/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uri: oauthParams.redirectUri,
          scope: oauthParams.scope,
          state: oauthParams.state,
          code_challenge: oauthParams.codeChallenge,
          code_challenge_method: oauthParams.codeChallengeMethod,
        }),
      });

      if (!response.ok) {
        const err = await response.json() as { error?: string; error_description?: string };
        throw new Error(err.error_description || err.error || 'Failed to create authorization code');
      }

      const data = await response.json() as { redirect_url?: string };

      if (data.redirect_url) {
        // Redirect back to Claude with the auth code
        window.location.href = data.redirect_url;
      } else {
        throw new Error('No redirect URL returned');
      }
    } catch (err) {
      console.error('OAuth consent error:', err);
      throw err;
    }
  };

  // Handle "Deny" - redirect to Claude with error
  const handleDeny = () => {
    if (oauthParams.redirectUri) {
      const url = new URL(oauthParams.redirectUri);
      url.searchParams.set('error', 'access_denied');
      url.searchParams.set('error_description', 'User denied the authorization request');
      if (oauthParams.state) {
        url.searchParams.set('state', oauthParams.state);
      }
      window.location.href = url.toString();
    } else {
      // No redirect URI, just go home
      router.push('/');
    }
  };

  // Loading state
  if (!isLoaded || isCheckingLeagues) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Invalid request (missing required params)
  if (!isValidRequest) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Invalid Authorization Request</h1>
          <p className="text-muted-foreground">
            This authorization request is missing required parameters.
            Please try connecting from Claude again.
          </p>
          <button
            onClick={() => router.push('/')}
            className="text-primary underline hover:no-underline"
          >
            Go to FLAIM
          </button>
        </div>
      </div>
    );
  }

  // Not signed in - show Clerk sign-in
  if (!isSignedIn) {
    // Build return URL with all OAuth params preserved
    const returnUrl = `/oauth/consent?${searchParams.toString()}`;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold">Sign in to continue</h1>
            <p className="text-muted-foreground">
              Sign in to your FLAIM account to authorize Claude.
            </p>
          </div>
          <SignIn
            routing="hash"
            afterSignInUrl={returnUrl}
            afterSignUpUrl={returnUrl}
          />
        </div>
      </div>
    );
  }

  // Signed in - show consent screen
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <ConsentScreen
        oauthParams={oauthParams}
        onAllow={handleAllow}
        onDeny={handleDeny}
        hasLeaguesConfigured={hasLeaguesConfigured}
      />
    </div>
  );
}

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <OAuthConsentContent />
    </Suspense>
  );
}
