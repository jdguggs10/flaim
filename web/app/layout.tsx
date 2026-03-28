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
  title: {
    default: 'Flaim Fantasy — Connect Your Fantasy Leagues to AI',
    template: '%s | Flaim',
  },
  description: "Flaim connects your ESPN, Yahoo, and Sleeper fantasy leagues to Claude, ChatGPT, and Perplexity. Get AI analysis based on your real roster, matchups, standings, and waiver wire — read-only.",
  metadataBase: new URL('https://flaim.app'),
  openGraph: {
    title: "Flaim Fantasy — Connect Your Fantasy Leagues to AI",
    description: "Flaim connects your ESPN, Yahoo, and Sleeper fantasy leagues to Claude, ChatGPT, and Perplexity. Get AI analysis based on your real roster, matchups, standings, and waiver wire — read-only.",
    url: "https://flaim.app",
    siteName: "Flaim",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Flaim Fantasy — Connect Your Fantasy Leagues to AI",
    description: "Flaim connects your ESPN, Yahoo, and Sleeper fantasy leagues to Claude, ChatGPT, and Perplexity. Get AI analysis based on your real roster, matchups, standings, and waiver wire — read-only.",
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
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify([
                {
                  '@context': 'https://schema.org',
                  '@type': 'SoftwareApplication',
                  name: 'Flaim Fantasy',
                  description: 'Flaim connects your ESPN, Yahoo, and Sleeper fantasy leagues to Claude, ChatGPT, and Perplexity for read-only, league-specific analysis.',
                  applicationCategory: 'SportsApplication',
                  applicationSubCategory: 'Fantasy Sports AI Tool',
                  operatingSystem: 'Web',
                  url: 'https://flaim.app',
                  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
                  featureList: [
                    'ESPN fantasy league integration',
                    'Yahoo fantasy league integration',
                    'Sleeper fantasy league integration',
                    'MCP (Model Context Protocol) server',
                    'Works with Claude, ChatGPT, and Perplexity',
                    'Read-only access — no trades, drops, or roster changes',
                    '9 MCP tools: roster, standings, matchups, free agents, transactions, league info, player search, league history, session',
                  ],
                  author: { '@type': 'Person', name: 'Gerry' },
                },
                {
                  '@context': 'https://schema.org',
                  '@type': 'Organization',
                  name: 'Flaim',
                  url: 'https://flaim.app',
                  logo: 'https://flaim.app/flaim-mark-hero.png',
                  founder: { '@type': 'Person', name: 'Gerry' },
                  sameAs: [
                    'https://github.com/jdguggs10/flaim',
                    'https://www.threads.com/@jdguggs10',
                  ],
                },
              ]),
            }}
          />
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="flaim-theme">
            <ClerkThemeWrapper>
              {children}
            </ClerkThemeWrapper>
          </ThemeProvider>
        </body>
      </html>
  );
}
