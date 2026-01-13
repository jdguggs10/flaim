"use client";

import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Flame, Menu } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const NAV_LINKS = [
  { href: '/extension', label: 'Extension' },
  { href: '/connectors', label: 'Connectors' },
  { href: '/leagues', label: 'Leagues' },
] as const;

/**
 * Site header with full navigation.
 * Used on all pages except /chat which has its own minimal header.
 */
export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
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
            <div className="flex items-center justify-between gap-3 sm:justify-start">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="sm:hidden"
                    aria-label="Open navigation menu"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-48 p-2">
                  <nav className="flex flex-col gap-1">
                    {NAV_LINKS.map((link) => (
                      <Button key={link.href} asChild variant="ghost" className="justify-start text-sm">
                        <Link href={link.href}>{link.label}</Link>
                      </Button>
                    ))}
                  </nav>
                </PopoverContent>
              </Popover>
              <nav className="hidden items-center gap-1 sm:flex">
                {NAV_LINKS.map((link) => (
                  <Button key={link.href} asChild variant="ghost" className="text-sm">
                    <Link href={link.href}>{link.label}</Link>
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
