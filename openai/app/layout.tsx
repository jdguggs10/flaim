import type { Metadata } from "next";
import localFont from "next/font/local";
import { ClerkProvider } from '@flaim/auth/web/components';
import { AuthHeader } from '@flaim/auth/web/components';
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
            {/* Render the authentication-aware header on the client to prevent SSR hydration mismatches */}
            <AuthHeader />
            <main className="flex-1 bg-background">{children}</main>
          </div>
        </ClerkProvider>
      </body>
    </html>
  );
}
