/**
 * Shared KV Storage Utility for ESPN API Routes
 * ---------------------------------------------------------------------------
 * 
 * Provides a centralized, memoized KV storage instance factory for use across
 * ESPN API routes. Avoids re-creating the EspnKVStorage wrapper multiple times
 * per request.
 * 
 * Usage:
 *   import { getKVStorage } from '@/../../auth/espn/kv';
 *   const storage = getKVStorage();
 * 
 * @version 1.0
 */

import { EspnKVStorage } from './kv-storage';

/**
 * Context for KV operations - workers can inject bindings without process.env
 */
export interface KVContext {
  kv: KVNamespace;
  encryptionKey: string;
}

// Memoized KV storage per request to avoid re-creating wrapper multiple times
let _kvStorageInstance: EspnKVStorage | null = null;

/**
 * Get or create a memoized KV storage instance for the current request
 */
export function getKVStorage(): EspnKVStorage {
  if (_kvStorageInstance) {
    return _kvStorageInstance;
  }
  
  if (!process.env.CF_KV_CREDENTIALS || !process.env.CF_ENCRYPTION_KEY) {
    throw new Error('CF KV environment not configured. Set CF_KV_CREDENTIALS and CF_ENCRYPTION_KEY.');
  }
  
  _kvStorageInstance = new EspnKVStorage({
    CF_KV_CREDENTIALS: process.env.CF_KV_CREDENTIALS as any,
    CF_ENCRYPTION_KEY: process.env.CF_ENCRYPTION_KEY
  });
  
  return _kvStorageInstance;
}

/**
 * Clear the memoized storage instance (useful for testing)
 */
export function clearKVStorageCache(): void {
  _kvStorageInstance = null;
}

/**
 * Create a new KV storage instance with custom configuration
 */
export function createKVStorage(options: {
  kvCredentials: any;
  encryptionKey: string;
}): EspnKVStorage {
  return new EspnKVStorage({
    CF_KV_CREDENTIALS: options.kvCredentials,
    CF_ENCRYPTION_KEY: options.encryptionKey
  });
}

/**
 * Create KV storage from worker context (CF Workers environment)
 */
export function createKVStorageFromContext(context: KVContext): EspnKVStorage {
  return new EspnKVStorage({
    kv: context.kv,
    encryptionKey: context.encryptionKey
  });
}