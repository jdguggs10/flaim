import type { Metadata } from "next";
import localFont from "next/font/local";
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
  title: "Responses starter app",
  description: "Starter app for the OpenAI Responses API",
  icons: {
    icon: "/openai_logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ClerkProvider>
          <div className="flex h-screen bg-muted w-full flex-col text-foreground">
            {/* Simple authentication header */}
            <header className="flex justify-between items-center p-4 bg-white border-b">
              <h1 className="text-xl font-bold">FLAIM - Fantasy League AI Assistant</h1>
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
                  <UserButton />
                </SignedIn>
              </div>
            </header>
            <main className="flex-1 bg-background">{children}</main>
          </div>
        </ClerkProvider>
      </body>
    </html>
  );
}
