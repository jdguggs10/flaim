/**
 * Chrome Storage Utilities
 * ---------------------------------------------------------------------------
 * Wrapper for chrome.storage.local API to persist extension token.
 */

const TOKEN_KEY = 'flaim_extension_token';

/**
 * Get stored extension token
 */
export async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  return result[TOKEN_KEY] || null;
}

/**
 * Store extension token
 */
export async function setToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

/**
 * Clear stored extension token
 */
export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}

/**
 * Check if extension is paired (has stored token)
 */
export async function isPaired(): Promise<boolean> {
  const token = await getToken();
  return token !== null;
}
