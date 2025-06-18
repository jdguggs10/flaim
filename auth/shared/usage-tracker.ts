/**
 * Cross-platform usage tracking for FLAIM users
 * Tracks message usage with limits for free users
 * Extracted from openai/lib/usage-tracker.ts
 */

import { UserUsage, UsageCheckResult, UsageStats, UserPlan } from './interfaces.js';
import { authConfig } from './config.js';

// In-memory storage for demo - in production, use a database
const userUsageStore = new Map<string, UserUsage>();

const RESET_INTERVAL_DAYS = 30; // Reset every 30 days

export class UsageTracker {
  private static getResetDate(): string {
    const date = new Date();
    date.setDate(date.getDate() + RESET_INTERVAL_DAYS);
    return date.toISOString();
  }

  private static isResetNeeded(resetDate: string): boolean {
    return new Date(resetDate) <= new Date();
  }

  static getUserUsage(userId: string): UserUsage {
    let usage = userUsageStore.get(userId);
    
    if (!usage) {
      // New user - default to free tier
      usage = {
        userId,
        messageCount: 0,
        resetDate: this.getResetDate(),
        plan: 'free'
      };
      userUsageStore.set(userId, usage);
    }

    // Check if usage needs to be reset
    if (this.isResetNeeded(usage.resetDate)) {
      usage.messageCount = 0;
      usage.resetDate = this.getResetDate();
      userUsageStore.set(userId, usage);
    }

    return usage;
  }

  static canSendMessage(userId: string): UsageCheckResult {
    const usage = this.getUserUsage(userId);
    
    // Paid users have unlimited access
    if (usage.plan === 'paid') {
      return { allowed: true, usage };
    }

    // Free users have limited access
    const limit = authConfig.usageLimits.free;
    const allowed = usage.messageCount < limit;
    const remaining = Math.max(0, limit - usage.messageCount);
    
    return { allowed, usage, remaining };
  }

  static incrementUsage(userId: string): UserUsage {
    const usage = this.getUserUsage(userId);
    
    // Only increment for free users (paid users are unlimited)
    if (usage.plan === 'free') {
      usage.messageCount++;
      userUsageStore.set(userId, usage);
    }
    
    return usage;
  }

  static updateUserPlan(userId: string, plan: UserPlan): UserUsage {
    const usage = this.getUserUsage(userId);
    usage.plan = plan;
    userUsageStore.set(userId, usage);
    return usage;
  }

  static upgradeToPaid(userId: string): UserUsage {
    return this.updateUserPlan(userId, 'paid');
  }

  static downgradeToFree(userId: string): UserUsage {
    return this.updateUserPlan(userId, 'free');
  }

  // Helper method to get usage stats for the frontend
  static getUsageStats(userId: string): UsageStats {
    const usage = this.getUserUsage(userId);
    
    if (usage.plan === 'paid') {
      return {
        plan: 'paid',
        messageCount: usage.messageCount,
        limit: null,
        remaining: null,
        resetDate: usage.resetDate
      };
    }

    const limit = authConfig.usageLimits.free;
    return {
      plan: 'free',
      messageCount: usage.messageCount,
      limit,
      remaining: Math.max(0, limit - usage.messageCount),
      resetDate: usage.resetDate
    };
  }

  // Utility methods for testing and admin
  static clearUsage(userId: string): void {
    userUsageStore.delete(userId);
  }

  static getAllUsers(): UserUsage[] {
    return Array.from(userUsageStore.values());
  }

  static setUsageForTesting(userId: string, usage: Partial<UserUsage>): void {
    const existingUsage = this.getUserUsage(userId);
    const updatedUsage = { ...existingUsage, ...usage };
    userUsageStore.set(userId, updatedUsage);
  }
}