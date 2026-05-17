import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import { ClerkThemeWrapper } from "@/components/clerk-theme-wrapper";
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
    default: "Flaim — Fantasy Leagues for ChatGPT",
    template: "%s | Flaim",
  },
  description:
    "Flaim Fantasy is available in ChatGPT Apps. Connect ESPN, Yahoo, and Sleeper leagues for read-only fantasy analysis in ChatGPT, with optional MCP setup for Claude, Perplexity, Gemini CLI, and supported developer/testing setups.",
  metadataBase: new URL("https://flaim.app"),
  openGraph: {
    title: "Flaim — Fantasy Leagues for ChatGPT",
    description:
      "Flaim Fantasy is available in ChatGPT Apps. Connect ESPN, Yahoo, and Sleeper leagues for read-only, league-specific fantasy analysis.",
    url: "https://flaim.app",
    siteName: "Flaim",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Flaim — Fantasy Leagues for ChatGPT",
    description:
      "Flaim Fantasy is available in ChatGPT Apps. Connect ESPN, Yahoo, and Sleeper leagues for read-only fantasy analysis.",
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
                  "Flaim Fantasy connects ESPN, Yahoo, and Sleeper fantasy league data to ChatGPT for read-only, league-specific analysis through ChatGPT Apps.",
                applicationCategory: "SportsApplication",
                applicationSubCategory: "Fantasy Sports AI Tool",
                operatingSystem: "Web",
                url: "https://flaim.app",
                offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
                featureList: [
                  "ESPN fantasy league integration",
                  "Yahoo fantasy league integration",
                  "Sleeper fantasy league integration",
                  "Available in ChatGPT Apps",
                  "ChatGPT fantasy sports analysis",
                  "MCP (Model Context Protocol) server",
                  "Manual MCP setup for Claude, Perplexity, Gemini CLI, and supported developer/testing setups",
                  "Read-only access — no trades, drops, or roster changes",
                  "9 MCP tools: roster, standings, matchups, free agents, transactions, league info, player search, league history, session",
                ],
                author: { "@type": "Person", name: "Gerry" },
              },
              {
                "@context": "https://schema.org",
                "@type": "Organization",
                name: "Flaim",
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
          <ClerkThemeWrapper>{children}</ClerkThemeWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
