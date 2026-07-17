/**
 * Client-side device classification for the ESPN mobile-wall UX and signals.
 * Heuristic, not exact: phones and tablets count as 'mobile' because neither
 * can run the Chrome extension. iPads on recent iPadOS report a Mac UA, so
 * touch-point detection covers them.
 */
export type DeviceClass = 'mobile' | 'desktop';

export function getDeviceClass(): DeviceClass {
  if (typeof navigator === 'undefined') {
    return 'desktop';
  }

  if (/Mobi|Android|iPhone|iPod|iPad/i.test(navigator.userAgent)) {
    return 'mobile';
  }

  // iPadOS 13+ masquerades as macOS but is still touch-first and extensionless.
  if (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1) {
    return 'mobile';
  }

  return 'desktop';
}
