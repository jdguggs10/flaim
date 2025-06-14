/**
 * Token lifecycle management for cross-platform authentication
 * Handles token refresh, validation, and session lifecycle events
 */

import { AuthSession } from './interfaces.js';
import { AuthConfig } from './config.js';

// Token event types
export type TokenEvent = 
  | 'token-refreshed'
  | 'token-expired' 
  | 'session-ended'
  | 'refresh-failed';

// Token refresh result
export interface TokenRefreshResult {
  success: boolean;
  token?: string;
  error?: string;
  expiresAt?: number;
}

// Session lifecycle events
export interface SessionEvent {
  type: TokenEvent;
  userId: string;
  timestamp: number;
  data?: any;
}

// Event listener type
export type TokenEventListener = (event: SessionEvent) => void;

// Token refresh provider interface (implemented by platform-specific code)
export interface TokenRefreshProvider {
  refreshToken(token: string): Promise<TokenRefreshResult>;
  validateToken(token: string): Promise<boolean>;
  revokeToken(token: string): Promise<void>;
}

class TokenManagerImpl {
  private refreshProvider: TokenRefreshProvider | null = null;
  private eventListeners: Map<TokenEvent, TokenEventListener[]> = new Map();
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Set the platform-specific token refresh provider
   */
  setRefreshProvider(provider: TokenRefreshProvider): void {
    this.refreshProvider = provider;
  }

  /**
   * Add event listener for token lifecycle events
   */
  addEventListener(event: TokenEvent, listener: TokenEventListener): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(event: TokenEvent, listener: TokenEventListener): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit token event to all listeners
   */
  private emitEvent(event: SessionEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error(`Error in token event listener for ${event.type}:`, error);
        }
      });
    }
  }

  /**
   * Refresh an expired or soon-to-expire token
   */
  async refreshToken(token: string, userId: string): Promise<TokenRefreshResult> {
    if (!this.refreshProvider) {
      return {
        success: false,
        error: 'Token refresh provider not configured'
      };
    }

    try {
      const result = await this.refreshProvider.refreshToken(token);
      
      if (result.success) {
        this.emitEvent({
          type: 'token-refreshed',
          userId,
          timestamp: Date.now(),
          data: { newToken: result.token, expiresAt: result.expiresAt }
        });

        // Schedule next refresh if expiration time is provided
        if (result.expiresAt) {
          this.scheduleTokenRefresh(result.token!, userId, result.expiresAt);
        }
      } else {
        this.emitEvent({
          type: 'refresh-failed',
          userId,
          timestamp: Date.now(),
          data: { error: result.error }
        });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.emitEvent({
        type: 'refresh-failed',
        userId,
        timestamp: Date.now(),
        data: { error: errorMessage }
      });

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Validate if a token is still valid
   */
  async validateToken(token: string): Promise<boolean> {
    if (!this.refreshProvider) {
      console.warn('Token refresh provider not configured');
      return false;
    }

    try {
      return await this.refreshProvider.validateToken(token);
    } catch (error) {
      console.error('Token validation failed:', error);
      return false;
    }
  }

  /**
   * Revoke a token (logout)
   */
  async revokeToken(token: string, userId: string): Promise<void> {
    if (!this.refreshProvider) {
      console.warn('Token refresh provider not configured');
      return;
    }

    try {
      await this.refreshProvider.revokeToken(token);
      
      // Clear any scheduled refreshes
      this.clearTokenRefresh(userId);
      
      this.emitEvent({
        type: 'session-ended',
        userId,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Token revocation failed:', error);
      throw error;
    }
  }

  /**
   * Schedule automatic token refresh before expiration
   */
  private scheduleTokenRefresh(token: string, userId: string, expiresAt: number): void {
    // Clear existing timer
    this.clearTokenRefresh(userId);

    // Schedule refresh 5 minutes before expiration
    const refreshTime = expiresAt - (5 * 60 * 1000); // 5 minutes in ms
    const delay = refreshTime - Date.now();

    if (delay > 0) {
      const timer = setTimeout(async () => {
        try {
          await this.refreshToken(token, userId);
        } catch (error) {
          console.error('Scheduled token refresh failed:', error);
        }
      }, delay);

      this.refreshTimers.set(userId, timer);
    }
  }

  /**
   * Clear scheduled token refresh
   */
  private clearTokenRefresh(userId: string): void {
    const timer = this.refreshTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(userId);
    }
  }

  /**
   * Handle token expiration
   */
  handleTokenExpired(userId: string, token: string): void {
    this.clearTokenRefresh(userId);
    
    this.emitEvent({
      type: 'token-expired',
      userId,
      timestamp: Date.now(),
      data: { expiredToken: token }
    });
  }

  /**
   * Get JWT payload without verification (for debugging)
   */
  decodeTokenPayload(token: string): any {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }

      const payload = parts[1];
      const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(decoded);
    } catch (error) {
      console.error('Failed to decode token payload:', error);
      return null;
    }
  }

  /**
   * Check if token is expired based on JWT payload
   */
  isTokenExpired(token: string): boolean {
    const payload = this.decodeTokenPayload(token);
    if (!payload || !payload.exp) {
      return true; // Assume expired if we can't decode
    }

    const now = Math.floor(Date.now() / 1000);
    return payload.exp < now;
  }

  /**
   * Clean up all timers and listeners
   */
  cleanup(): void {
    // Clear all refresh timers
    this.refreshTimers.forEach(timer => clearTimeout(timer));
    this.refreshTimers.clear();
    
    // Clear all event listeners
    this.eventListeners.clear();
  }
}

// Export singleton instance
export const TokenManager = new TokenManagerImpl();

// Export types and interfaces
export type { TokenRefreshProvider, SessionEvent, TokenEventListener };