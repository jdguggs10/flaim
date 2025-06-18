export const isWorker = typeof globalThis !== 'undefined' && 'DurableObject' in globalThis;
export const isBrowser = typeof globalThis !== 'undefined' && 'window' in globalThis;
export const isNode = typeof globalThis !== 'undefined' && 'process' in globalThis;
export const isNextJS = isNode && typeof (globalThis as any).process === 'object' && (globalThis as any).process.env?.NEXT_RUNTIME !== undefined;

export function getPlatform(): 'worker' | 'browser' | 'node' | 'nextjs' {
  if (isWorker) return 'worker';
  if (isNextJS) return 'nextjs';
  if (isBrowser) return 'browser';
  if (isNode) return 'node';
  throw new Error('Unknown platform');
}