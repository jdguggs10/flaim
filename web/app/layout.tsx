import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from '@/components/theme-provider';
import { ClerkThemeWrapper } from '@/components/clerk-theme-wrapper';
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Flaim Fantasy",
  description: "Read-only fantasy analysis for ESPN, Yahoo, and Sleeper with unified league context for standings, rosters, matchups, and free agents",
  metadataBase: new URL('https://flaim.app'),
  openGraph: {
    title: "Flaim Fantasy",
    description: "Read-only fantasy analysis for ESPN, Yahoo, and Sleeper with unified league context for standings, rosters, matchups, and free agents",
    url: "https://flaim.app",
    siteName: "Flaim",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Flaim Fantasy",
    description: "Read-only fantasy analysis for ESPN, Yahoo, and Sleeper with unified league context for standings, rosters, matchups, and free agents",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-light.png", type: "image/png", media: "(prefers-color-scheme: light)" },
      { url: "/icon-dark.png", type: "image/png", media: "(prefers-color-scheme: dark)" },
    ],
    apple: "/apple-icon.png",
  },
};

/**
 * Root layout - minimal wrapper with ClerkProvider.
 * Site header is rendered in (site) layout.
 * Chat has its own header in (chat) layout.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
      <html lang="en" suppressHydrationWarning>
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="flaim-theme">
            <ClerkThemeWrapper>
              {children}
            </ClerkThemeWrapper>
          </ThemeProvider>
        </body>
      </html>
  );
}
