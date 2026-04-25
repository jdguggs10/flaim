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
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

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
  } catch (err) {
    // Distinguish a timeout-driven abort from a caller-driven abort so
    // callers can silently ignore their own cancellation while still
    // surfacing stalled requests as a real error.
    if (timedOut) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
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
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { user } = useUser();

  const [hasCredentials, setHasCredentials] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [credentialsUserId, setCredentialsUserId] = useState<string | null>(null);
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
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentUserIdRef.current = isSignedIn ? userId ?? null : null;
  }, [isSignedIn, userId]);

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

    editControllerRef.current?.abort();
    editControllerRef.current = null;
    saveControllerRef.current?.abort();
    saveControllerRef.current = null;
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }
    setIsEditingCreds(false);
    setIsLoadingCreds(false);
    setCredsSaving(false);
    setSwid('');
    setEspnS2('');
    setCredsError(null);
    setCredsSuccess(false);

    if (!isSignedIn || !userId) {
      setHasCredentials(false);
      setLastUpdated(null);
      setCredentialsUserId(null);
      setIsCheckingCreds(false);
      return;
    }

    const controller = new AbortController();
    setHasCredentials(false);
    setLastUpdated(null);
    setCredentialsUserId(userId);
    setIsCheckingCreds(true);

    const loadCredentials = async () => {
      try {
        const credsRes = await fetchWithTimeout('/api/auth/espn/credentials', {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (credsRes.ok) {
          const data = await credsRes.json() as { hasCredentials?: boolean; lastUpdated?: string };
          const connected = !!data.hasCredentials;
          setHasCredentials(connected);
          setLastUpdated(connected ? data.lastUpdated || null : null);
        } else {
          setHasCredentials(false);
          setLastUpdated(null);
        }
      } catch (err) {
        if (isAbortError(err)) return;
        console.error('Failed to check credentials:', err);
        setHasCredentials(false);
        setLastUpdated(null);
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
  }, [isLoaded, isSignedIn, userId]);

  const handleEditCredentials = async () => {
    const operationUserId = currentUserIdRef.current;
    const shouldApply = () => Boolean(operationUserId && currentUserIdRef.current === operationUserId);
    if (!shouldApply()) return;

    editControllerRef.current?.abort();
    const controller = new AbortController();
    editControllerRef.current = controller;

    setIsLoadingCreds(true);
    setCredsError(null);

    let errored = false;
    try {
      const res = await fetchWithTimeout('/api/auth/espn/credentials?forEdit=true', {
        signal: controller.signal,
      });
      if (controller.signal.aborted || !shouldApply()) return;
      if (res.ok) {
        const data = await res.json() as { hasCredentials?: boolean; swid?: string; s2?: string };
        if (!shouldApply()) return;
        if (data.swid) setSwid(data.swid);
        if (data.s2) setEspnS2(data.s2);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      if (!shouldApply()) return;
      errored = true;
      console.error('Failed to fetch credentials for editing:', err);
      setCredsError(err instanceof Error ? err.message : 'Failed to load credentials');
    } finally {
      if (!controller.signal.aborted && shouldApply()) {
        setIsLoadingCreds(false);
        if (!errored) {
          setIsEditingCreds(true);
        }
      }
      if (editControllerRef.current === controller) {
        editControllerRef.current = null;
      }
    }
  };

  const handleSaveCredentials = async () => {
    const operationUserId = currentUserIdRef.current;
    const shouldApply = () => Boolean(operationUserId && currentUserIdRef.current === operationUserId);
    if (!shouldApply()) return;

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
      if (controller.signal.aborted || !shouldApply()) return;

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        if (!shouldApply()) return;
        throw new Error(data.error || 'Failed to save credentials');
      }

      setHasCredentials(true);
      setCredentialsUserId(operationUserId);
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
      if (!shouldApply()) return;
      setCredsError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      if (!controller.signal.aborted && shouldApply()) {
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

  const isCredentialStateCurrent = Boolean(isLoaded && isSignedIn && userId && credentialsUserId === userId);
  const isCredentialStatusPending = Boolean(isLoaded && isSignedIn && userId && !isCredentialStateCurrent);

  return {
    hasCredentials: isCredentialStateCurrent && hasCredentials,
    lastUpdated: isCredentialStateCurrent ? lastUpdated : null,
    isCheckingCreds: isCheckingCreds || isCredentialStatusPending,
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
