"use client";

import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import Image from 'next/image';

const NAV_LINKS = [
  { href: '/leagues', label: 'Your Leagues', labelShort: 'Leagues' },
] as const;

/**
 * Site header with full navigation.
 * Used on all pages except /chat which has its own minimal header.
 */
export function SiteHeader() {
  return (
    <header className="w-full border-b bg-background">
      <div className="flex min-h-[4rem] w-full flex-row flex-wrap items-center justify-between gap-3 p-4 sm:flex-nowrap">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xl font-bold transition-opacity hover:opacity-80"
        >
          <Image src="/flaim-mark-hero.png" alt="Flaim" width={32} height={32} className="dark:brightness-0 dark:invert" />
          <span>Flaim</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <SignedOut>
            <div className="flex flex-row gap-2">
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
            <div className="flex items-center gap-2 sm:gap-3">
              <nav className="flex items-center gap-1 sm:gap-2">
                {NAV_LINKS.map((link) => (
                  <Button key={link.href} asChild variant="ghost" className="text-sm">
                    <Link href={link.href}>
                      <span className="sm:hidden">{link.labelShort}</span>
                      <span className="hidden sm:inline">{link.label}</span>
                    </Link>
                  </Button>
                ))}
              </nav>
              <div className="flex items-center gap-2 sm:border-l sm:pl-2">
                <UserButton />
              </div>
            </div>
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
