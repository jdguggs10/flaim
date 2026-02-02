"use client";

import { useTheme } from "next-themes";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";

export function ClerkThemeWrapper({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();

  return (
    <ClerkProvider
      allowedRedirectOrigins={[
        "chrome-extension://mbnokejgglkfgkeeenolgdpcnfakpbkn", // CWS production
      ]}
      appearance={resolvedTheme === "dark" ? { baseTheme: dark } : undefined}
    >
      {children}
    </ClerkProvider>
  );
}
