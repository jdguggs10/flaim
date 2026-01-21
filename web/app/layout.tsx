import type { Metadata } from "next";
import localFont from "next/font/local";
import { ClerkProvider } from '@clerk/nextjs';
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
  title: "Flaim - Fantasy League AI Connector",
  description: "Connect your AI assistant to ESPN fantasy sports",
  icons: {
    icon: "/favicon.ico",
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
    <ClerkProvider
      allowedRedirectOrigins={[
        'chrome-extension://mbnokejgglkfgkeeenolgdpcnfakpbkn', // CWS production
      ]}
    >
      <html lang="en">
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
