"use client";

import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Flame } from 'lucide-react';
import { AccountButton } from '@/components/site/AccountButton';

/**
 * Site header with full navigation.
 * Used on all pages except /chat which has its own minimal header.
 */
export function SiteHeader() {
  return (
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
  );
}
