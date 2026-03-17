"use client";

import React, { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth, SignIn } from '@clerk/nextjs';
import ConsentScreen from '@/components/site/connectors/ConsentScreen';
import { Loader2 } from 'lucide-react';

// League checking removed - OAuth consent should work regardless of fantasy setup
// Tools handle missing configuration gracefully when called

// Must stay in sync with workers/auth-worker/src/oauth-handlers.ts isValidRedirectUri()
const ALLOWED_REDIRECT_HOSTS = [
  'claude.ai',
  'claude.com',
  'cdn.claude.ai',
  'chatgpt.com',
  'platform.openai.com',
  'gemini.google.com',
];

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);

    // HTTPS host allowlist (covers Claude web, ChatGPT, OpenAI, Gemini)
    if (url.protocol === 'https:') {
      return ALLOWED_REDIRECT_HOSTS.some(
        host => url.hostname === host || url.hostname.endsWith('.' + host)
      );
    }

    // Loopback callbacks for Claude Desktop (RFC 8252)
    if (url.protocol === 'http:') {
      const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      const isCallback = url.pathname === '/callback' || url.pathname === '/oauth/callback';
      return isLoopback && isCallback;
    }

    return false;
  } catch {
    return false;
  }
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

  // Removed league checking - OAuth consent works regardless of fantasy setup

  // Extract OAuth params from URL
  const oauthState = searchParams.get('oauth_state') || searchParams.get('state') || undefined;
  const oauthParams = {
    redirectUri: searchParams.get('redirect_uri') || '',
    state: oauthState,
    scope: searchParams.get('scope') || 'mcp:read',
    codeChallenge: searchParams.get('code_challenge') || undefined,
    codeChallengeMethod: searchParams.get('code_challenge_method') || 'S256',
    clientId: searchParams.get('client_id') || undefined,
    resource: searchParams.get('resource') || undefined, // RFC 8707
  };

  // Validate required params
  const isValidRequest = oauthParams.redirectUri
    && oauthParams.codeChallenge
    && isAllowedRedirectUri(oauthParams.redirectUri);

  // League checking removed - tools handle missing configuration when called

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
          client_id: oauthParams.clientId,
          code_challenge: oauthParams.codeChallenge,
          code_challenge_method: oauthParams.codeChallengeMethod,
          resource: oauthParams.resource, // RFC 8707
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
    if (oauthParams.redirectUri && isAllowedRedirectUri(oauthParams.redirectUri)) {
      const url = new URL(oauthParams.redirectUri);
      url.searchParams.set('error', 'access_denied');
      url.searchParams.set('error_description', 'User denied the authorization request');
      if (oauthParams.state) {
        url.searchParams.set('state', oauthParams.state);
      }
      window.location.href = url.toString();
    } else {
      router.push('/');
    }
  };

  // Loading state
  if (!isLoaded) {
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
            Please try connecting from Claude or ChatGPT again.
          </p>
          <button
            onClick={() => router.push('/')}
            className="text-primary underline hover:no-underline"
          >
            Go to Flaim
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
              Sign in to your Flaim account to authorize access.
          </p>
          </div>
          <SignIn
            routing="hash"
            forceRedirectUrl={returnUrl}
            signUpForceRedirectUrl={returnUrl}
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
