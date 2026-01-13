"use client";

import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Flame } from 'lucide-react';

/**
 * Site header with full navigation.
 * Used on all pages except /chat which has its own minimal header.
 */
export function SiteHeader() {
  return (
    <header className="flex flex-col gap-3 border-b bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-xl font-bold transition-opacity hover:opacity-80"
      >
        <Flame className="h-5 w-5" />
        <span>Flaim</span>
      </Link>
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
        <SignedOut>
          <div className="flex flex-col gap-2 sm:flex-row">
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
          <nav className="flex flex-wrap items-center gap-1">
            <Button asChild variant="ghost" className="text-xs sm:text-sm">
              <Link href="/extension">Extension</Link>
            </Button>
            <Button asChild variant="ghost" className="text-xs sm:text-sm">
              <Link href="/connectors">Connectors</Link>
            </Button>
            <Button asChild variant="ghost" className="text-xs sm:text-sm">
              <Link href="/leagues">Leagues</Link>
            </Button>
          </nav>
          <div className="flex items-center gap-2 sm:border-l sm:pl-2">
            <UserButton />
          </div>
        </SignedIn>
      </div>
    </header>
  );
}
