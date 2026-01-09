import { useEffect, useRef, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';

export interface EspnCredentialsState {
  hasCredentials: boolean;
  isCheckingCreds: boolean;
  isEditingCreds: boolean;
  isLoadingCreds: boolean;
  swid: string;
  espnS2: string;
  showCredentials: boolean;
  credsSaving: boolean;
  credsError: string | null;
  credsSuccess: boolean;
  showCredsHelp: boolean;
  setSwid: (value: string) => void;
  setEspnS2: (value: string) => void;
  setShowCredentials: (value: boolean) => void;
  setShowCredsHelp: (value: boolean) => void;
  handleEditCredentials: () => Promise<void>;
  handleSaveCredentials: () => Promise<void>;
  handleCancelEdit: () => void;
}

export function useEspnCredentials(): EspnCredentialsState {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  const [hasCredentials, setHasCredentials] = useState(false);
  const [isCheckingCreds, setIsCheckingCreds] = useState(true);
  const [isEditingCreds, setIsEditingCreds] = useState(false);
  const [isLoadingCreds, setIsLoadingCreds] = useState(false);
  const [swid, setSwid] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [showCredentials, setShowCredentials] = useState(false);
  const [credsSaving, setCredsSaving] = useState(false);
  const [credsError, setCredsError] = useState<string | null>(null);
  const [credsSuccess, setCredsSuccess] = useState(false);
  const [showCredsHelp, setShowCredsHelp] = useState(false);

  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setHasCredentials(false);
      setIsCheckingCreds(false);
      return;
    }

    let isActive = true;

    const loadCredentials = async () => {
      try {
        const credsRes = await fetch('/api/auth/espn/credentials');
        if (!isActive) return;
        if (credsRes.ok) {
          const data = await credsRes.json() as { hasCredentials?: boolean };
          setHasCredentials(!!data.hasCredentials);
        }
      } catch (err) {
        console.error('Failed to check credentials:', err);
      } finally {
        if (isActive) {
          setIsCheckingCreds(false);
        }
      }
    };

    loadCredentials();

    return () => {
      isActive = false;
    };
  }, [isLoaded, isSignedIn]);

  const handleEditCredentials = async () => {
    setIsLoadingCreds(true);
    setCredsError(null);

    try {
      const res = await fetch('/api/auth/espn/credentials?forEdit=true');
      if (res.ok) {
        const data = await res.json() as { hasCredentials?: boolean; swid?: string; s2?: string };
        if (data.swid) setSwid(data.swid);
        if (data.s2) setEspnS2(data.s2);
      }
    } catch (err) {
      console.error('Failed to fetch credentials for editing:', err);
    } finally {
      setIsLoadingCreds(false);
      setIsEditingCreds(true);
    }
  };

  const handleSaveCredentials = async () => {
    if (!swid.trim() || !espnS2.trim()) {
      setCredsError('Both SWID and ESPN_S2 are required');
      return;
    }

    setCredsSaving(true);
    setCredsError(null);

    try {
      const res = await fetch('/api/auth/espn/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          swid: swid.trim(),
          s2: espnS2.trim(),
          email: user?.primaryEmailAddress?.emailAddress,
        }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to save credentials');
      }

      setHasCredentials(true);
      setIsEditingCreds(false);
      setSwid('');
      setEspnS2('');
      setCredsSuccess(true);

      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      successTimeoutRef.current = setTimeout(() => setCredsSuccess(false), 3000);
    } catch (err) {
      setCredsError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setCredsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditingCreds(false);
    setSwid('');
    setEspnS2('');
    setCredsError(null);
  };

  return {
    hasCredentials,
    isCheckingCreds,
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
  };
}
