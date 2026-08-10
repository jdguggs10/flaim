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
    default: "Flaim Fantasy | Your Real Fantasy Leagues in AI",
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
                  "Flaim Fantasy connects ESPN, Yahoo, and Sleeper fantasy leagues to ChatGPT, Claude, and supported AI assistants. It provides read-only access to your roster, matchup, standings, available players, recent moves, league rules, and history.",
                applicationCategory: "SportsApplication",
                applicationSubCategory: "Fantasy Sports AI Tool",
                operatingSystem: "Web",
                url: "https://flaim.app",
                offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
                featureList: [
                  "Connect ESPN, Yahoo, and Sleeper fantasy leagues",
                  "Use connected fantasy leagues in ChatGPT and Claude",
                  "Ask about your roster, matchup, standings, available players, recent moves, league rules, and history",
                  "Read-only access with no trades, player adds or drops, lineup edits, or league-setting changes",
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
                founder: {
                  "@type": "Person",
                  name: "Gerry",
                  sameAs: ["https://www.threads.com/@jdguggs10"],
                },
                sameAs: ["https://www.threads.com/@flaim_app"],
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
