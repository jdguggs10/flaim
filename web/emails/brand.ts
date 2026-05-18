export const emailBrand = {
  name: "Flaim",
  url: "https://flaim.app",
  supportEmail: "support@flaim.app",
  senders: {
    // Dashboard-only auth sender. Product templates should use senders.product.
    clerk: "Flaim <accounts@flaim.app>",
    product: "Flaim <updates@send.flaim.app>",
    replyTo: "support@flaim.app",
  },
  colors: {
    background: "#f9fafb",
    card: "#ffffff",
    foreground: "#030712",
    mutedForeground: "#6b7280",
    border: "#e5e7eb",
    primary: "#111827",
    primaryForeground: "#f8fafc",
    muted: "#f3f4f6",
    success: "#22c55e",
    warning: "#f59e0b",
  },
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  radius: {
    card: "8px",
    button: "6px",
  },
} as const;

export type EmailBrand = typeof emailBrand;
