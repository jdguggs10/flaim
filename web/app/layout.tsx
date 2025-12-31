import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { ClerkProvider, SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
          <div className="flex h-screen bg-muted w-full flex-col text-foreground">
            {/* Site header */}
            <header className="flex justify-between items-center p-4 bg-white border-b">
              <Link href="/" className="text-xl font-bold hover:opacity-80 transition-opacity">
                Flaim
              </Link>
              <div className="flex items-center gap-4">
                <SignedOut>
                  <div className="flex gap-2">
                    <SignInButton>
                      <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                        Sign In
                      </button>
                    </SignInButton>
                    <SignUpButton>
                      <button className="px-4 py-2 border border-blue-600 text-blue-600 rounded hover:bg-blue-50">
                        Sign Up
                      </button>
                    </SignUpButton>
                  </div>
                </SignedOut>
                <SignedIn>
                  <Link
                    href="/leagues"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Leagues
                  </Link>
                  <Link
                    href="/connectors"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Connectors
                  </Link>
                  <Link
                    href="/account"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Account
                  </Link>
                  <Link
                    href="/extension"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Extension
                  </Link>
                  <UserButton />
                </SignedIn>
              </div>
            </header>
            <main className="flex-1 bg-background overflow-auto">{children}</main>
          </div>
        </body>
      </html>
    </ClerkProvider>
  );
}
