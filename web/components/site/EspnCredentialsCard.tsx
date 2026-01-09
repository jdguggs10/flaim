"use client";

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Shield,
} from 'lucide-react';
import type { EspnCredentialsState } from '@/lib/use-espn-credentials';

interface EspnCredentialsCardProps {
  credentials: EspnCredentialsState;
}

export function EspnCredentialsCard({ credentials }: EspnCredentialsCardProps) {
  const {
    hasCredentials,
    isEditingCreds,
    isLoadingCreds,
    swid,
    espnS2,
    showCredentials,
    credsSaving,
    credsError,
    credsSuccess,
    showCredsHelp,
    setSwid,
    setEspnS2,
    setShowCredentials,
    setShowCredsHelp,
    handleEditCredentials,
    handleSaveCredentials,
    handleCancelEdit,
  } = credentials;

  return (
    <>
      {credsSuccess && (
        <Alert className="bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>ESPN credentials saved successfully.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">ESPN Credentials</CardTitle>
          <CardDescription>
            Your ESPN authentication cookies are required to access your leagues.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasCredentials && !isEditingCreds ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <span className="font-medium">Credentials saved</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEditCredentials}
                  disabled={isLoadingCreds}
                >
                  {isLoadingCreds ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Update'
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {credsError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {credsError}
                    {credsError.toLowerCase().includes('failed') && (
                      <span className="block mt-1 text-sm">
                        Check that your credentials are current. See the help section below for how to find them.
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="swid">SWID</Label>
                <div className="relative">
                  <Input
                    id="swid"
                    type={showCredentials ? 'text' : 'password'}
                    placeholder="Enter your SWID"
                    value={swid}
                    onChange={(e) => setSwid(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                    onClick={() => setShowCredentials(!showCredentials)}
                  >
                    {showCredentials ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="espn_s2">ESPN_S2</Label>
                <Input
                  id="espn_s2"
                  type={showCredentials ? 'text' : 'password'}
                  placeholder="Enter your ESPN_S2"
                  value={espnS2}
                  onChange={(e) => setEspnS2(e.target.value)}
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSaveCredentials} disabled={credsSaving}>
                  {credsSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Credentials'
                  )}
                </Button>
                {isEditingCreds && (
                  <Button variant="outline" onClick={handleCancelEdit}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg text-sm">
            <Shield className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-muted-foreground">
              Your credentials are encrypted and stored securely. We only use them to fetch
              your fantasy data — never shared with anyone.{' '}
              <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>
            </p>
          </div>

          <div className="border-t pt-4">
            <button
              type="button"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowCredsHelp(!showCredsHelp)}
            >
              {showCredsHelp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              How to find your ESPN credentials manually
            </button>
            {showCredsHelp && (
              <div className="mt-3 p-4 bg-muted rounded-lg text-sm space-y-3">
                <ol className="list-decimal list-inside space-y-2">
                  <li>Log in to <a href="https://espn.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">espn.com</a></li>
                  <li>Open browser Developer Tools (F12 or right-click &gt; Inspect)</li>
                  <li>Go to Application &gt; Cookies &gt; espn.com</li>
                  <li>Find and copy the values for <code className="bg-background px-1 rounded">SWID</code> and <code className="bg-background px-1 rounded">espn_s2</code></li>
                </ol>
                <Button variant="outline" size="sm" asChild>
                  <a
                    href="https://support.espn.com/hc/en-us"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    ESPN Help Center
                  </a>
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
