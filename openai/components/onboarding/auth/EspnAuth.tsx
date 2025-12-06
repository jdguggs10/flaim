"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Alert, AlertDescription } from '../../ui/alert';
import { Eye, EyeOff, HelpCircle, Loader2, Shield } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import useOnboardingStore, { type Platform } from '@/stores/useOnboardingStore';
import SkipStepBanner from '../SkipStepBanner';

interface PlatformAuthProps {
  platform?: Platform;
}

export default function EspnAuth({ platform = 'ESPN' }: PlatformAuthProps = {}) {
  const [showCredentials, setShowCredentials] = useState(false);
  
  // TODO: Expand for other platforms (currently supports ESPN, Yahoo)
  // ESPN: { swid, espn_s2 }
  // Yahoo: { access_token, refresh_token? }
  // Future: Sleeper, other platforms
  const [credentials, setCredentials] = useState({
    swid: '',
    espn_s2: ''
  });
  const [showInstructions, setShowInstructions] = useState(false);
  
  const { userId } = useAuth();
  
  const { 
    setError, 
    error, 
    isAuthenticating, 
    setIsAuthenticating,
    setPlatformCredentials,
    setStep
  } = useOnboardingStore();

  const [hasStoredCreds, setHasStoredCreds] = useState(false);

  // Auto-check stored credentials via API proxy on mount
  useEffect(() => {
    (async () => {
      if (!userId) return;
      try {
        const res = await fetch('/api/auth/espn/credentials');
        if (res.ok) {
          const data = await res.json() as { hasCredentials?: boolean };
          if (data?.hasCredentials) {
            setHasStoredCreds(true);
          }
        }
      } catch {
        /* network error ignored */
      }
    })();
  }, [userId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!credentials.swid.trim() || !credentials.espn_s2.trim()) {
      setError('Please enter both SWID and ESPN_S2 credentials');
      return;
    }

    if (!userId) {
      setError('Authentication required. Please sign in first.');
      return;
    }

    setIsAuthenticating(true);
    setError(null);

    try {
      // Store credentials in onboarding store
      setPlatformCredentials(platform, credentials);

      // Store credentials via API proxy
      const response = await fetch('/api/auth/espn/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          swid: credentials.swid,
          s2: credentials.espn_s2
        })
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || `Failed to authenticate with ${platform}`);
      }

      // Credentials stored successfully, move to manual league entry
      console.log(`✅ ${platform} credentials stored, moving to league entry step`);
      setStep('LEAGUE_ENTRY');

    } catch (error) {
      console.error(`${platform} authentication error:`, error);
      setError(error instanceof Error ? error.message : 'Authentication failed');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleInputChange = (field: 'swid' | 'espn_s2', value: string) => {
    setCredentials(prev => ({ ...prev, [field]: value }));
    if (error) setError(null);
  };

  return (
    <div className="space-y-6">
      {hasStoredCreds && (
        <SkipStepBanner
          text="Credentials already verified."
          onSkip={() => setStep('LEAGUE_ENTRY')}
        />
      )}

      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2">
          <div className="text-2xl">🏈</div>
          <h1 className="text-2xl font-bold text-foreground">Connect ESPN Account</h1>
        </div>
        <p className="text-muted-foreground">
          Enter your ESPN credentials to access your fantasy leagues
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            ESPN Authentication
          </CardTitle>
          <CardDescription>
            We&apos;ll securely store your credentials to access your ESPN fantasy data
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="swid">SWID</Label>
              <Input
                id="swid"
                type={showCredentials ? "text" : "password"}
                placeholder="Enter your ESPN SWID"
                value={credentials.swid}
                onChange={(e) => handleInputChange('swid', e.target.value)}
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="espn_s2">ESPN_S2</Label>
              <Input
                id="espn_s2"
                type={showCredentials ? "text" : "password"}
                placeholder="Enter your ESPN_S2 cookie"
                value={credentials.espn_s2}
                onChange={(e) => handleInputChange('espn_s2', e.target.value)}
                className="font-mono text-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowCredentials(!showCredentials)}
                className="flex items-center gap-2"
              >
                {showCredentials ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showCredentials ? 'Hide' : 'Show'} credentials
              </Button>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button 
              type="submit" 
              className="w-full" 
              disabled={isAuthenticating}
            >
              {isAuthenticating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Authenticating...
                </>
              ) : (
                'Connect ESPN Account'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle 
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => setShowInstructions(!showInstructions)}
          >
            <HelpCircle className="h-5 w-5" />
            How to find your ESPN credentials
          </CardTitle>
        </CardHeader>
        
        {showInstructions && (
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-3">
              <div>
                <h4 className="font-medium text-foreground">Step 1: Open ESPN Fantasy in your browser</h4>
                <p className="text-muted-foreground">Go to fantasy.espn.com and sign in to your account</p>
              </div>
              
              <div>
                <h4 className="font-medium text-foreground">Step 2: Open Developer Tools</h4>
                <p className="text-muted-foreground">
                  Press F12 (or right-click → Inspect) and go to the &quot;Application&quot; or &quot;Storage&quot; tab
                </p>
              </div>
              
              <div>
                <h4 className="font-medium text-foreground">Step 3: Find Cookies</h4>
                <p className="text-muted-foreground">
                  Look for cookies under &quot;fantasy.espn.com&quot; and find:
                </p>
                <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground ml-4">
                  <li><strong>SWID</strong> - Usually starts with curly braces {`{}`}</li>
                  <li><strong>espn_s2</strong> - Long string of characters</li>
                </ul>
              </div>
              
              <div>
                <h4 className="font-medium text-foreground">Step 4: Copy and Paste</h4>
                <p className="text-muted-foreground">
                  Copy the values and paste them into the fields above
                </p>
              </div>
            </div>

            <Alert>
              <Shield className="h-4 w-4" />
              <AlertDescription>
                Your credentials are encrypted and stored securely. We only use them to access your fantasy data.
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>
    </div>
  );
}