/**
 * Device helpers for labeling the extension instance.
 */

function getBrowserLabel(): string {
  if (typeof navigator === 'undefined') return 'Chrome';
  const brave = (navigator as typeof navigator & { brave?: { isBrave?: () => Promise<boolean> } }).brave;
  if (brave?.isBrave) {
    // Best-effort Brave detection (non-blocking)
    try {
      void brave.isBrave();
      return 'Brave';
    } catch {
      // Ignore and fall back to UA checks
    }
  }
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Brave\//.test(ua)) return 'Brave';
  return 'Chrome';
}

function formatOsName(os?: chrome.runtime.PlatformOs): string {
  switch (os) {
    case 'mac': return 'macOS';
    case 'win': return 'Windows';
    case 'linux': return 'Linux';
    case 'cros': return 'ChromeOS';
    case 'android': return 'Android';
    case 'openbsd': return 'OpenBSD';
    case 'fuchsia': return 'Fuchsia';
    default: return 'Unknown OS';
  }
}

export async function getDeviceLabel(): Promise<string> {
  try {
    const info = await chrome.runtime.getPlatformInfo();
    return `${getBrowserLabel()} on ${formatOsName(info.os)}`;
  } catch {
    return getBrowserLabel();
  }
}
