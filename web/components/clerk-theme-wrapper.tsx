"use client";

import { useTheme } from "next-themes";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";

const CLERK_LOCALIZATION_OVERRIDE = {
  userProfile: {
    deletePage: {
      messageLine1:
        "Are you sure you want to delete your account? This permanently deletes your Flaim account, connected ESPN, Yahoo, and Sleeper credentials, and saved league data.",
    },
  },
};

export function ClerkThemeWrapper({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();

  return (
    <ClerkProvider
      allowedRedirectOrigins={[
        "chrome-extension://mbnokejgglkfgkeeenolgdpcnfakpbkn", // CWS production
      ]}
      appearance={resolvedTheme === "dark" ? { baseTheme: dark } : undefined}
      localization={CLERK_LOCALIZATION_OVERRIDE}
    >
      {children}
    </ClerkProvider>
  );
}
