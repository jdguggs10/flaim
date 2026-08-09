"use client";

import Link from "next/link";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import Image from "next/image";

/**
 * Minimal product header for all public site pages.
 * Discovery and help navigation stays contextual within page content.
 */
export function SiteHeader() {
  return (
    <header className="w-full border-b bg-background">
      <div className="flex min-h-16 w-full items-center justify-between gap-3 p-4">
        <Link
          href="/"
          className="inline-flex shrink-0 items-center gap-2 text-xl font-bold transition-opacity hover:opacity-80"
        >
          <Image
            src="/flaim-mark-hero.png"
            alt=""
            width={32}
            height={32}
            className="dark:hidden"
          />
          <Image
            src="/flaim-mark-hero-dark.png"
            alt=""
            width={32}
            height={32}
            className="hidden dark:block"
          />
          <span>Flaim</span>
        </Link>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <SignedOut>
            <SignInButton mode="redirect">
              <Button variant="outline" size="sm">
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="redirect" fallbackRedirectUrl="/leagues">
              <Button size="sm">Get Started</Button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <nav aria-label="Account navigation">
              <Button asChild variant="ghost" size="sm" className="text-sm">
                <Link href="/leagues">Your Leagues</Link>
              </Button>
            </nav>
            <div className="flex items-center sm:border-l sm:pl-3">
              <UserButton />
            </div>
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
