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
import { Chrome, Check, Loader2, Monitor, LogIn, Shield, RefreshCw, Eye, EyeOff, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { pingExtension, isChromeBrowser, type ExtensionPingResult } from '@/lib/extension-ping';

const CHROME_EXTENSION_URL = "https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn";

type Status =
  | 'loading'
  | 'signed_out'
  | 'connected' // Ping successful + signed in via Clerk
  | 'installed_not_signed_in' // Ping successful but not signed in
  | 'not_installed' // Ping failed or not Chrome, no credentials
  | 'server_only' // Non-Chrome browser with credentials
  | 'non_chrome'; // Non-Chrome browser without credentials

interface StepSyncEspnProps {
  className?: string;
}

export function StepSyncEspn({ className }: StepSyncEspnProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [hasCredentials, setHasCredentials] = useState(false);

  // Credential editing state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [swid, setSwid] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [showCredentials, setShowCredentials] = useState(false);
  const [hasLoadedCreds, setHasLoadedCreds] = useState(false);
  const [isLoadingCreds, setIsLoadingCreds] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!isSignedIn) {
      setStatus('signed_out');
      return;
    }

    const checkConnection = async () => {
      const isChrome = isChromeBrowser();

      // Try to ping extension (only works in Chrome)
      let ping: ExtensionPingResult | null = null;
      if (isChrome) {
        try {
          ping = await pingExtension(1500);
        } catch {
          ping = null;
        }
      }

      // Check server status for credentials
      let serverHasCredentials = false;
      try {
        const response = await fetch('/api/extension/connection');
        if (response.ok) {
          const data = (await response.json()) as { connected?: boolean };
          serverHasCredentials = !!data.connected;
        }
      } catch {
        // Silently fail
      }

      // Also check ESPN credentials directly
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
      } catch {
        // Silently fail
      }

      // Determine status based on browser type and ping result
      if (ping?.reachable) {
        // Extension responded - use ping as source of truth
        if (ping.signedIn) {
          setStatus('connected');
        } else {
          setStatus('installed_not_signed_in');
        }
      } else if (!isChrome) {
        // Non-Chrome browser - show server data with disclaimer
        if (serverHasCredentials) {
          setStatus('server_only');
        } else {
          setStatus('non_chrome');
        }
      } else {
        // Chrome but couldn't reach extension
        setStatus('not_installed');
      }
    };

    checkConnection();
  }, [isLoaded, isSignedIn]);

  // Load credentials when dialog opens
  const handleOpenDialog = async () => {
    setDialogOpen(true);
    setIsLoadingCreds(true);
    setError(null);

    if (hasLoadedCreds || swid || espnS2) {
      setIsLoadingCreds(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/espn/credentials?forEdit=true');
      if (res.ok) {
        const data = await res.json() as { swid?: string; s2?: string };
        if (data.swid) setSwid(data.swid);
        if (data.s2) setEspnS2(data.s2);
        if (data.swid || data.s2) {
          setHasLoadedCreds(true);
        }
      }
    } catch (err) {
      console.error('Failed to fetch credentials:', err);
    } finally {
      setIsLoadingCreds(false);
    }
  };

  // Save credentials
  const handleSave = async () => {
    if (!swid.trim() || !espnS2.trim()) {
      setError('Both SWID and ESPN_S2 are required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/espn/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          swid: swid.trim(),
          s2: espnS2.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to save credentials');
      }

      setHasCredentials(true);
      setDialogOpen(false);
      setSwid('');
      setEspnS2('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setIsSaving(false);
    }
  };

  // Base card structure
  const renderCard = (content: React.ReactNode) => (
    <div className={`bg-background rounded-xl p-5 border flex flex-col ${className ?? ''}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
          2
        </div>
        <h3 className="font-semibold text-lg">Sync Credentials</h3>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Security information"
            >
              <Shield className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 text-sm">
            <p className="text-muted-foreground">
              Your credentials are encrypted and stored securely. We only use them to fetch
              your fantasy data — never shared with anyone.{' '}
              <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>
            </p>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-sm text-muted-foreground mb-2 flex-1">
        The Chrome extension grabs your ESPN credentials automatically.
      </p>
      {content}
    </div>
  );

  const renderCredentialsDialog = (label: string, variant: "ghost" | "outline", className?: string) => (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          className={className}
          onClick={handleOpenDialog}
        >
          {label === "Update" && <RefreshCw className="h-3.5 w-3.5 mr-1" />}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2 pr-8">
            <DialogTitle>ESPN Credentials</DialogTitle>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="How to find your ESPN credentials manually"
                >
                  <Info className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80 text-sm space-y-3">
                <ol className="list-decimal list-inside space-y-2">
                  <li>Log in to <a href="https://espn.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">espn.com</a></li>
                  <li>Open browser Developer Tools (F12 or right-click &gt; Inspect)</li>
                  <li>Go to Application &gt; Cookies &gt; espn.com</li>
                  <li>Find and copy the values for <code className="bg-background px-1 rounded">SWID</code> and <code className="bg-background px-1 rounded">espn_s2</code></li>
                </ol>
              </PopoverContent>
            </Popover>
          </div>
          <DialogDescription>
            View or update your ESPN authentication cookies.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {isLoadingCreds ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
                  {error}
                </div>
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
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    hasCredentials ? 'Update Credentials' : 'Add Credentials'
                  )}
                </Button>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
              </div>

            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

  const credentialsSavedRow = hasCredentials ? (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
        <Check className="h-4 w-4" />
        <span>Credentials saved</span>
      </div>
      {renderCredentialsDialog(
        "Update",
        "ghost",
        "h-7 px-2 text-muted-foreground hover:text-foreground"
      )}
    </div>
  ) : null;

  const credentialsAddRow = !hasCredentials ? (
    <div className="mt-2">
      {renderCredentialsDialog("Add manually", "outline", "w-full")}
    </div>
  ) : null;

  // Loading state
  if (!isLoaded || status === 'loading') {
    return renderCard(
      <div className="space-y-4">
        <a
          href={CHROME_EXTENSION_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button className="w-full" variant="outline">
            <Chrome className="h-4 w-4 mr-2" />
            Install Extension
          </Button>
        </a>
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking credentials...
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="invisible h-7 px-2"
            aria-hidden="true"
            tabIndex={-1}
          >
            Update
          </Button>
        </div>
      </div>
    );
  }

  // Signed out
  if (status === 'signed_out') {
    return renderCard(
      <a
        href={CHROME_EXTENSION_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button className="w-full text-muted-foreground" variant="outline">
          <Chrome className="h-4 w-4 mr-2" />
          Sign in first
        </Button>
      </a>
    );
  }

  // Connected - extension installed and signed in
  if (status === 'connected') {
    return renderCard(
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
          <Check className="h-4 w-4" />
          Extension connected
        </div>
        {credentialsSavedRow}
        {credentialsAddRow}
      </div>
    );
  }

  // Installed but not signed in via Clerk
  if (status === 'installed_not_signed_in') {
    return renderCard(
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-amber-600">
          <LogIn className="h-4 w-4" />
          <span>Sign in required</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Session will sync automatically. Try reopening the extension.
        </p>
        {credentialsSavedRow}
        {credentialsAddRow}
      </div>
    );
  }

  // Server only - non-Chrome browser with credentials synced
  if (status === 'server_only') {
    return renderCard(
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Monitor className="h-4 w-4" />
          <span>Non-Chrome browser</span>
        </div>
        {credentialsSavedRow}
        {credentialsAddRow}
      </div>
    );
  }

  // Non-Chrome browser without credentials
  if (status === 'non_chrome') {
    return renderCard(
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-blue-600">
          <Monitor className="h-4 w-4" />
          <span>Chrome required for extension</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Open this page in Chrome to install the extension, or add credentials manually below.
        </p>
        {credentialsSavedRow}
        {credentialsAddRow}
      </div>
    );
  }

  // Not installed - default (Chrome without extension)
  return renderCard(
    <div className="space-y-4">
      <a
        href={CHROME_EXTENSION_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Button className="w-full" variant="outline">
          <Chrome className="h-4 w-4 mr-2" />
          Install Extension
        </Button>
      </a>
      {credentialsSavedRow}
      {credentialsAddRow}
    </div>
  );
}
