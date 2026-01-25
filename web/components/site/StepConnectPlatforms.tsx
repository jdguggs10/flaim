'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Chrome, Check, Loader2, Shield, Eye, EyeOff } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { pingExtension, isChromeBrowser, type ExtensionPingResult } from '@/lib/extension-ping';

const CHROME_EXTENSION_URL = "https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn";

type EspnStatus =
  | 'loading'
  | 'connected'
  | 'installed_not_signed_in'
  | 'not_installed'
  | 'server_only'
  | 'non_chrome';

type YahooStatus = 'loading' | 'connected' | 'not_connected';

interface StepConnectPlatformsProps {
  className?: string;
}

export function StepConnectPlatforms({ className }: StepConnectPlatformsProps) {
  const { isLoaded, isSignedIn } = useAuth();

  // ESPN state
  const [espnStatus, setEspnStatus] = useState<EspnStatus>('loading');
  const [hasCredentials, setHasCredentials] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [swid, setSwid] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [showCredentials, setShowCredentials] = useState(false);
  const [hasLoadedCreds, setHasLoadedCreds] = useState(false);
  const [isLoadingCreds, setIsLoadingCreds] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [espnError, setEspnError] = useState<string | null>(null);

  // Yahoo state
  const [yahooStatus, setYahooStatus] = useState<YahooStatus>('loading');
  const [yahooLeagueCount, setYahooLeagueCount] = useState(0);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setEspnStatus('loading');
      setYahooStatus('loading');
      return;
    }

    // Check ESPN
    const checkEspn = async () => {
      const isChrome = isChromeBrowser();
      let ping: ExtensionPingResult | null = null;
      if (isChrome) {
        try {
          ping = await pingExtension(1500);
        } catch {
          ping = null;
        }
      }

      let serverHasCredentials = false;
      try {
        const response = await fetch('/api/extension/connection');
        if (response.ok) {
          const data = (await response.json()) as { connected?: boolean };
          serverHasCredentials = !!data.connected;
        }
      } catch { /* ignore */ }

      try {
        const credsRes = await fetch('/api/auth/espn/credentials?forEdit=true');
        if (credsRes.ok) {
          const data = (await credsRes.json()) as { hasCredentials?: boolean; swid?: string; s2?: string };
          setHasCredentials(!!data.hasCredentials);
          if (data.swid || data.s2) {
            if (data.swid) setSwid(data.swid);
            if (data.s2) setEspnS2(data.s2);
            setHasLoadedCreds(true);
          }
        }
      } catch { /* ignore */ }

      if (ping?.reachable) {
        setEspnStatus(ping.signedIn ? 'connected' : 'installed_not_signed_in');
      } else if (!isChrome) {
        setEspnStatus(serverHasCredentials ? 'server_only' : 'non_chrome');
      } else {
        setEspnStatus('not_installed');
      }
    };

    // Check Yahoo
    const checkYahoo = async () => {
      try {
        const res = await fetch('/api/connect/yahoo/status');
        if (res.ok) {
          const data = (await res.json()) as { connected?: boolean };
          if (data.connected) {
            setYahooStatus('connected');
            // Get league count
            const leaguesRes = await fetch('/api/connect/yahoo/leagues');
            if (leaguesRes.ok) {
              const leaguesData = (await leaguesRes.json()) as { leagues?: unknown[] };
              setYahooLeagueCount(leaguesData.leagues?.length || 0);
            }
          } else {
            setYahooStatus('not_connected');
          }
        } else {
          setYahooStatus('not_connected');
        }
      } catch {
        setYahooStatus('not_connected');
      }
    };

    checkEspn();
    checkYahoo();
  }, [isLoaded, isSignedIn]);

  const handleOpenDialog = async () => {
    setDialogOpen(true);
    if (hasLoadedCreds || swid || espnS2) {
      setIsLoadingCreds(false);
      return;
    }
    setIsLoadingCreds(true);
    try {
      const res = await fetch('/api/auth/espn/credentials?forEdit=true');
      if (res.ok) {
        const data = await res.json() as { swid?: string; s2?: string };
        if (data.swid) setSwid(data.swid);
        if (data.s2) setEspnS2(data.s2);
        if (data.swid || data.s2) setHasLoadedCreds(true);
      }
    } catch { /* ignore */ }
    setIsLoadingCreds(false);
  };

  const handleSaveCredentials = async () => {
    if (!swid.trim() || !espnS2.trim()) {
      setEspnError('Both SWID and ESPN_S2 are required');
      return;
    }
    setIsSaving(true);
    setEspnError(null);
    try {
      const res = await fetch('/api/auth/espn/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swid: swid.trim(), s2: espnS2.trim() }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to save credentials');
      }
      setHasCredentials(true);
      setDialogOpen(false);
    } catch (err) {
      setEspnError(err instanceof Error ? err.message : 'Failed to save');
    }
    setIsSaving(false);
  };

  const handleConnectYahoo = () => {
    window.location.href = '/api/connect/yahoo/authorize';
  };

  if (!isLoaded) {
    return (
      <div className={`bg-background rounded-xl p-5 border ${className ?? ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">2</div>
          <h3 className="font-semibold text-lg">Connect Your Leagues</h3>
        </div>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className={`bg-background rounded-xl p-5 border ${className ?? ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">2</div>
          <h3 className="font-semibold text-lg">Connect Your Leagues</h3>
        </div>
        <p className="text-sm text-muted-foreground">Sign in first to connect your fantasy platforms.</p>
      </div>
    );
  }

  return (
    <div className={`bg-background rounded-xl p-5 border ${className ?? ''}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">2</div>
        <h3 className="font-semibold text-lg">Connect Your Leagues</h3>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="ml-auto text-muted-foreground hover:text-foreground transition-colors" aria-label="Security information">
              <Shield className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 text-sm">
            <p className="text-muted-foreground">
              Your credentials are encrypted and stored securely. We only use them to fetch your fantasy data.{' '}
              <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>
            </p>
          </PopoverContent>
        </Popover>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* ESPN Column */}
        <div className="p-4 border rounded-lg space-y-3">
          <div className="font-medium text-sm">ESPN</div>
          <p className="text-xs text-muted-foreground">Chrome extension grabs credentials automatically.</p>

          {espnStatus === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking...
            </div>
          ) : espnStatus === 'connected' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                <Check className="h-4 w-4" />
                Extension connected
              </div>
              {hasCredentials && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <Check className="h-4 w-4" />
                  Credentials saved
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <a href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="w-full">
                  <Chrome className="h-4 w-4 mr-2" />
                  Install Extension
                </Button>
              </a>
              {hasCredentials && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <Check className="h-4 w-4" />
                  Credentials saved
                </div>
              )}
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={handleOpenDialog}>
                    Add manually
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>ESPN Credentials</DialogTitle>
                    <DialogDescription>Enter your ESPN authentication cookies.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    {isLoadingCreds ? (
                      <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                    ) : (
                      <>
                        {espnError && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{espnError}</div>}
                        <div className="space-y-2">
                          <Label htmlFor="swid">SWID</Label>
                          <Input id="swid" type={showCredentials ? 'text' : 'password'} value={swid} onChange={(e) => setSwid(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="espn_s2">ESPN_S2</Label>
                          <Input id="espn_s2" type={showCredentials ? 'text' : 'password'} value={espnS2} onChange={(e) => setEspnS2(e.target.value)} />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setShowCredentials(!showCredentials)}>
                            {showCredentials ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
                            {showCredentials ? 'Hide' : 'Show'}
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={handleSaveCredentials} disabled={isSaving}>
                            {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Save
                          </Button>
                          <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        </div>
                      </>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>

        {/* Yahoo Column */}
        <div className="p-4 border rounded-lg space-y-3">
          <div className="font-medium text-sm">Yahoo</div>
          <p className="text-xs text-muted-foreground">Sign in with Yahoo to auto-discover leagues.</p>

          {yahooStatus === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking...
            </div>
          ) : yahooStatus === 'connected' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                <Check className="h-4 w-4" />
                Connected
              </div>
              {yahooLeagueCount > 0 && (
                <div className="text-xs text-muted-foreground">
                  {yahooLeagueCount} league{yahooLeagueCount !== 1 ? 's' : ''} discovered
                </div>
              )}
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={handleConnectYahoo}>
              Connect Yahoo
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
