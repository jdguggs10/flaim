/**
 * Usage tracking components with Clerk integration
 * Extracted from openai/components/usage-display.tsx
 */

"use client";

import React, { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { UsageStats } from '../../shared/interfaces.js';

/**
 * Usage display component
 * Shows current usage statistics for authenticated users
 */
export interface UsageDisplayProps {
  className?: string;
  showDetails?: boolean;
  refreshInterval?: number; // ms
}

export function UsageDisplay({ 
  className = "text-sm text-gray-600",
  showDetails = true,
  refreshInterval = 30000 // 30 seconds
}: UsageDisplayProps) {
  const { isSignedIn } = useUser();
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = async () => {
    if (!isSignedIn) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/usage');
      const data = await response.json();
      
      if (data.success) {
        setUsage(data.usage);
      } else {
        setError(data.error || 'Failed to fetch usage');
      }
    } catch (err) {
      setError('Network error');
      console.error('Usage fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSignedIn) {
      fetchUsage();
      
      // Set up refresh interval
      const interval = setInterval(fetchUsage, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [isSignedIn, refreshInterval]);

  if (!isSignedIn) {
    return null;
  }

  if (loading && !usage) {
    return (
      <div className={className}>
        <span>Loading usage...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${className} text-red-600`}>
        <span>Error: {error}</span>
      </div>
    );
  }

  if (!usage) {
    return null;
  }

  const formatResetDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const getUsageColor = () => {
    if (usage.plan === 'paid') return 'text-green-600';
    if (usage.remaining && usage.remaining < 5) return 'text-red-600';
    if (usage.remaining && usage.remaining < 10) return 'text-yellow-600';
    return 'text-blue-600';
  };

  return (
    <div className={className}>
      <div className={`flex items-center gap-2 ${getUsageColor()}`}>
        <span className="font-medium">
          {usage.plan === 'paid' ? 'Pro Plan' : 'Free Plan'}
        </span>
        
        {usage.plan === 'free' && (
          <>
            <span>•</span>
            <span>
              {usage.remaining}/{usage.limit} remaining
            </span>
          </>
        )}
        
        {usage.plan === 'paid' && (
          <>
            <span>•</span>
            <span>Unlimited</span>
          </>
        )}
      </div>
      
      {showDetails && (
        <div className="text-xs text-gray-500 mt-1">
          {usage.messageCount} messages used
          {usage.plan === 'free' && (
            <> • Resets {formatResetDate(usage.resetDate)}</>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Usage warning component
 * Shows warnings when approaching limits
 */
export interface UsageWarningProps {
  className?: string;
  warningThreshold?: number; // remaining messages to show warning
}

export function UsageWarning({ 
  className = "p-3 bg-yellow-50 border border-yellow-200 rounded",
  warningThreshold = 5
}: UsageWarningProps) {
  const { isSignedIn } = useUser();
  const [usage, setUsage] = useState<UsageStats | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    
    const fetchUsage = async () => {
      try {
        const response = await fetch('/api/usage');
        const data = await response.json();
        if (data.success) {
          setUsage(data.usage);
        }
      } catch (error) {
        console.error('Usage fetch error:', error);
      }
    };

    fetchUsage();
  }, [isSignedIn]);

  if (!isSignedIn || !usage || usage.plan === 'paid') {
    return null;
  }

  if (!usage.remaining || usage.remaining > warningThreshold) {
    return null;
  }

  if (usage.remaining === 0) {
    return (
      <div className={`${className} bg-red-50 border-red-200`}>
        <div className="flex items-center gap-2">
          <span className="text-red-600 font-medium">Limit Reached</span>
        </div>
        <p className="text-sm text-red-700 mt-1">
          You've reached your free tier limit. Upgrade to continue using FLAIM.
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <span className="text-yellow-600 font-medium">
          {usage.remaining} messages remaining
        </span>
      </div>
      <p className="text-sm text-yellow-700 mt-1">
        You're approaching your free tier limit. Consider upgrading for unlimited access.
      </p>
    </div>
  );
}

/**
 * Upgrade prompt component
 */
export interface UpgradePromptProps {
  className?: string;
  onUpgrade?: () => void;
}

export function UpgradePrompt({ 
  className = "p-4 bg-blue-50 border border-blue-200 rounded",
  onUpgrade
}: UpgradePromptProps) {
  const { isSignedIn } = useUser();

  if (!isSignedIn) {
    return null;
  }

  return (
    <div className={className}>
      <h3 className="font-medium text-blue-900 mb-2">Upgrade to Pro</h3>
      <p className="text-sm text-blue-700 mb-3">
        Get unlimited messages and access to premium features.
      </p>
      <button
        onClick={onUpgrade}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
      >
        Upgrade Now
      </button>
    </div>
  );
}