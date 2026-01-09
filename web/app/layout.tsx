import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { ClerkProvider, SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Flame } from 'lucide-react';
import { AccountButton } from '@/components/site/AccountButton';
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
            <header className="flex justify-between items-center p-4 bg-background border-b">
              <Link
                href="/"
                className="inline-flex items-center gap-2 text-xl font-bold hover:opacity-80 transition-opacity"
              >
                <Flame className="h-5 w-5" />
                <span>Flaim</span>
              </Link>
              <div className="flex items-center gap-4">
                <SignedOut>
                  <div className="flex gap-2">
                    <SignInButton>
                      <Button variant="outline">
                        Sign In
                      </Button>
                    </SignInButton>
                    <SignUpButton>
                      <Button>
                        Sign Up
                      </Button>
                    </SignUpButton>
                  </div>
                </SignedOut>
                <SignedIn>
                  <nav className="flex items-center gap-1">
                    <Button asChild variant="ghost" className="text-sm">
                      <Link href="/extension">Extension</Link>
                    </Button>
                    <Button asChild variant="ghost" className="text-sm">
                      <Link href="/connectors">Connectors</Link>
                    </Button>
                    <Button asChild variant="ghost" className="text-sm">
                      <Link href="/leagues">Leagues</Link>
                    </Button>
                    <AccountButton />
                  </nav>
                  <div className="flex items-center gap-2 pl-2 border-l">
                    <UserButton />
                  </div>
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
