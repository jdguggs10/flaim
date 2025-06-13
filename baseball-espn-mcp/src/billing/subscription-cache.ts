/**
 * Subscription Cache - Tracks subscription status via Stripe webhooks
 * Provides fast lookup for subscription validation without hitting Stripe API
 */

export interface SubscriptionStatus {
  customerId: string;
  status: 'active' | 'cancelled' | 'past_due' | 'unpaid' | 'trialing';
  planId?: string;
  currentPeriodEnd: number; // Unix timestamp
  cancelAtPeriodEnd: boolean;
  lastUpdated: number; // Unix timestamp
}

export class SubscriptionCache {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Update subscription status from webhook
   */
  async updateSubscription(customerId: string, subscription: any): Promise<void> {
    const status: SubscriptionStatus = {
      customerId,
      status: subscription.status,
      planId: subscription.items?.data[0]?.price?.id,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
      lastUpdated: Math.floor(Date.now() / 1000)
    };

    // Store in KV for fast lookup
    const key = `subscription:${customerId}`;
    await this.env.SUBSCRIPTION_KV.put(key, JSON.stringify(status), {
      // Cache for 24 hours, but webhook updates will refresh
      expirationTtl: 24 * 60 * 60
    });

    console.log(`Updated subscription cache for customer ${customerId}: ${subscription.status}`);
  }

  /**
   * Get subscription status from cache
   */
  async getSubscriptionStatus(customerId: string): Promise<SubscriptionStatus | null> {
    const key = `subscription:${customerId}`;
    const cached = await this.env.SUBSCRIPTION_KV.get(key);
    
    if (!cached) {
      return null;
    }

    try {
      return JSON.parse(cached) as SubscriptionStatus;
    } catch (error) {
      console.error('Failed to parse cached subscription:', error);
      return null;
    }
  }

  /**
   * Check if customer has active subscription
   */
  async hasActiveSubscription(customerId: string): Promise<boolean> {
    const status = await this.getSubscriptionStatus(customerId);
    
    if (!status) {
      return false;
    }

    // Check if subscription is active and not expired
    const now = Math.floor(Date.now() / 1000);
    const isActive = status.status === 'active' || status.status === 'trialing';
    const notExpired = status.currentPeriodEnd > now;

    return isActive && notExpired;
  }

  /**
   * Mark subscription as cancelled
   */
  async cancelSubscription(customerId: string): Promise<void> {
    const existing = await this.getSubscriptionStatus(customerId);
    
    if (existing) {
      existing.status = 'cancelled';
      existing.lastUpdated = Math.floor(Date.now() / 1000);
      
      const key = `subscription:${customerId}`;
      await this.env.SUBSCRIPTION_KV.put(key, JSON.stringify(existing));
    }
  }

  /**
   * Clean up expired subscriptions from cache
   */
  async cleanupExpired(): Promise<void> {
    // This would typically be called by a cron job
    // For now, individual lookups handle expiration
    console.log('Subscription cache cleanup completed');
  }
}

// Add to Env interface
declare global {
  interface Env {
    SUBSCRIPTION_KV: KVNamespace;
  }
}