import type { Metadata } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "@/components/theme-provider";
import { ClerkThemeWrapper } from "@/components/clerk-theme-wrapper";
import { AcquisitionFirstTouch } from "@/components/acquisition-first-touch";
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
  title: {
    default: "Flaim Fantasy — Your Real Fantasy Leagues in AI",
    template: "%s | Flaim Fantasy",
  },
  description:
    "Connect your ESPN, Yahoo, or Sleeper fantasy leagues to the AI you already use. Get read-only analysis of your real roster, matchups, standings, waiver wire, transactions, and league history.",
  metadataBase: new URL("https://flaim.app"),
  openGraph: {
    title: "Your fantasy league, inside your AI.",
    description:
      "Real ESPN, Yahoo, and Sleeper league data. Read-only fantasy analysis. No screenshots or copy-pasting.",
    url: "https://flaim.app",
    siteName: "Flaim Fantasy",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Your fantasy league, inside your AI.",
    description:
      "Real ESPN, Yahoo, and Sleeper league data. Read-only fantasy analysis. No screenshots or copy-pasting.",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      {
        url: "/icon-light.png",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark.png",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                "@context": "https://schema.org",
                "@type": "SoftwareApplication",
                name: "Flaim Fantasy",
                description:
                  "Flaim Fantasy connects ESPN, Yahoo, and Sleeper fantasy league data to supported AI assistants for league-specific analysis. Fantasy-provider access is read-only: Flaim cannot make trades, add or drop players, edit lineups, or change league settings.",
                applicationCategory: "SportsApplication",
                applicationSubCategory: "Fantasy Sports AI Tool",
                operatingSystem: "Web",
                url: "https://flaim.app",
                offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
                featureList: [
                  "ESPN fantasy league integration",
                  "Yahoo fantasy league integration",
                  "Sleeper fantasy league integration",
                  "Real roster, matchup, standings, waiver, transaction, player, league-setting, and history context",
                  "Nine read-only analysis tools plus a bounded connected-league Refresh",
                  "No trades, adds, drops, lineup edits, or fantasy-provider changes",
                  "Free, with no Flaim subscription",
                ],
                author: { "@type": "Person", name: "Gerry" },
              },
              {
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: "Flaim Fantasy",
                alternateName: "Flaim",
                url: "https://flaim.app",
              },
              {
                "@context": "https://schema.org",
                "@type": "Organization",
                name: "Flaim Fantasy",
                alternateName: "Flaim",
                url: "https://flaim.app",
                logo: "https://flaim.app/flaim-mark-hero.png",
                founder: { "@type": "Person", name: "Gerry" },
                sameAs: [
                  "https://github.com/jdguggs10/flaim",
                  "https://www.threads.com/@jdguggs10",
                ],
              },
            ]),
          }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          storageKey="flaim-theme"
        >
          <ClerkThemeWrapper>
            <AcquisitionFirstTouch />
            {children}
          </ClerkThemeWrapper>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
