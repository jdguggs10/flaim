"use client";

import { useUser } from '@clerk/nextjs';
import { useEffect, useState, useCallback } from "react";
import useHasMounted from "@/hooks/useHasMounted";

interface UsageStats {
  plan: 'free' | 'paid';
  messageCount: number;
  limit: number | null;
  remaining: number | null;
  resetDate: string;
}

export default function UsageDisplay() {
  // Prevent SSR–client HTML mismatch while keeping hook order intact
  const hasMounted = useHasMounted();
  const { isSignedIn } = useUser();
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchUsage = useCallback(async () => {
    if (!isSignedIn) return;
    
    try {
      setLoading(true);
      const response = await fetch('/api/chat/usage');
      const data = await response.json() as { success?: boolean; usage?: any };
      
      if (data.success) {
        setUsage(data.usage);
      }
    } catch (error) {
      console.error('Failed to fetch usage:', error);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn]);

  const handleUpgrade = async () => {
    try {
      const response = await fetch('/api/chat/usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upgrade' })
      });
      
      const data = await response.json() as { success?: boolean; usage?: any };
      if (data.success) {
        setUsage(data.usage);
      }
    } catch (error) {
      console.error('Failed to upgrade:', error);
    }
  };

  const handleDowngrade = async () => {
    try {
      const response = await fetch('/api/chat/usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'downgrade' })
      });
      
      const data = await response.json() as { success?: boolean; usage?: any };
      if (data.success) {
        setUsage(data.usage);
      }
    } catch (error) {
      console.error('Failed to downgrade:', error);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, [isSignedIn, fetchUsage]);

  // Avoid hydration mismatch: wait until after mount
  if (!hasMounted) {
    return null;
  }

  if (!isSignedIn || loading) {
    return null;
  }

  if (!usage) {
    return (
      <div className="p-4 bg-card rounded-lg shadow-sm border border-border">
        <p className="text-sm text-muted-foreground">Loading usage...</p>
      </div>
    );
  }

  const resetDate = new Date(usage.resetDate).toLocaleDateString();

  return (
    <div className="p-4 bg-card rounded-lg shadow-sm border border-border">
      <div className="flex justify-between items-start mb-3">
        <h3 className="font-semibold text-lg text-card-foreground">Usage Status</h3>
        <span className={`px-2 py-1 rounded text-xs font-medium ${
          usage.plan === 'paid' 
            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' 
            : 'bg-secondary text-secondary-foreground'
        }`}>
          {usage.plan === 'paid' ? 'Paid Plan' : 'Free Plan'}
        </span>
      </div>

      {usage.plan === 'free' ? (
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Messages Used</span>
              <span>{usage.messageCount} / {usage.limit}</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div 
                className={`h-2 rounded-full ${
                  (usage.remaining || 0) <= 3 ? 'bg-destructive' : 
                  (usage.remaining || 0) <= 7 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ 
                  width: `${((usage.messageCount || 0) / (usage.limit || 1)) * 100}%` 
                }}
              ></div>
            </div>
          </div>
          
          <p className="text-sm text-muted-foreground">
            {usage.remaining} messages remaining
          </p>
          
          {(usage.remaining || 0) <= 5 && (
            <div className="p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded">
              <p className="text-sm text-orange-800 dark:text-orange-300 mb-2">
                You&apos;re running low on messages!
              </p>
              <button
                onClick={handleUpgrade}
                className="w-full px-3 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 text-sm font-medium transition-colors"
              >
                Upgrade for Unlimited Messages
              </button>
            </div>
          )}
          
          <p className="text-xs text-muted-foreground">
            Usage resets on {resetDate}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-green-600">✓</span>
            <span className="text-sm">Unlimited messages</span>
          </div>
          
          <p className="text-sm text-muted-foreground">
            Total messages sent: {usage.messageCount}
          </p>
          
          {/* Demo downgrade button - remove in production */}
          <button
            onClick={handleDowngrade}
            className="w-full px-3 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 text-sm font-medium transition-colors"
          >
            Downgrade to Free (Demo)
          </button>
        </div>
      )}
    </div>
  );
}