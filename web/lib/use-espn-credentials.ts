import { useEffect, useRef, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';

export interface EspnCredentialsState {
  hasCredentials: boolean;
  lastUpdated: string | null;
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

const DEFAULT_TIMEOUT_MS = 10_000;

type FetchInit = RequestInit & { timeoutMs?: number; signal?: AbortSignal };

async function fetchWithTimeout(url: string, init: FetchInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = init;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let callerAbortListener: (() => void) | null = null;
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerAbortListener = () => controller.abort();
      callerSignal.addEventListener('abort', callerAbortListener);
    }
  }

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    if (callerSignal && callerAbortListener) {
      callerSignal.removeEventListener('abort', callerAbortListener);
    }
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export function useEspnCredentials(): EspnCredentialsState {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  const [hasCredentials, setHasCredentials] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
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
  const editControllerRef = useRef<AbortController | null>(null);
  const saveControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      editControllerRef.current?.abort();
      saveControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setHasCredentials(false);
      setIsCheckingCreds(false);
      return;
    }

    const controller = new AbortController();

    const loadCredentials = async () => {
      try {
        const credsRes = await fetchWithTimeout('/api/auth/espn/credentials', {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (credsRes.ok) {
          const data = await credsRes.json() as { hasCredentials?: boolean; lastUpdated?: string };
          setHasCredentials(!!data.hasCredentials);
          setLastUpdated(data.lastUpdated || null);
        }
      } catch (err) {
        if (isAbortError(err)) return;
        console.error('Failed to check credentials:', err);
      } finally {
        if (!controller.signal.aborted) {
          setIsCheckingCreds(false);
        }
      }
    };

    loadCredentials();

    return () => {
      controller.abort();
    };
  }, [isLoaded, isSignedIn]);

  const handleEditCredentials = async () => {
    editControllerRef.current?.abort();
    const controller = new AbortController();
    editControllerRef.current = controller;

    setIsLoadingCreds(true);
    setCredsError(null);

    try {
      const res = await fetchWithTimeout('/api/auth/espn/credentials?forEdit=true', {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (res.ok) {
        const data = await res.json() as { hasCredentials?: boolean; swid?: string; s2?: string };
        if (data.swid) setSwid(data.swid);
        if (data.s2) setEspnS2(data.s2);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      console.error('Failed to fetch credentials for editing:', err);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingCreds(false);
        setIsEditingCreds(true);
      }
      if (editControllerRef.current === controller) {
        editControllerRef.current = null;
      }
    }
  };

  const handleSaveCredentials = async () => {
    if (!swid.trim() || !espnS2.trim()) {
      setCredsError('Both SWID and ESPN_S2 are required');
      return;
    }

    saveControllerRef.current?.abort();
    const controller = new AbortController();
    saveControllerRef.current = controller;

    setCredsSaving(true);
    setCredsError(null);

    try {
      const res = await fetchWithTimeout('/api/auth/espn/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          swid: swid.trim(),
          s2: espnS2.trim(),
          email: user?.primaryEmailAddress?.emailAddress,
        }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

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
      if (isAbortError(err)) return;
      setCredsError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      if (!controller.signal.aborted) {
        setCredsSaving(false);
      }
      if (saveControllerRef.current === controller) {
        saveControllerRef.current = null;
      }
    }
  };

  const handleCancelEdit = () => {
    editControllerRef.current?.abort();
    editControllerRef.current = null;
    setIsEditingCreds(false);
    setSwid('');
    setEspnS2('');
    setCredsError(null);
  };

  return {
    hasCredentials,
    lastUpdated,
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
