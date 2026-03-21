import type { Metadata } from 'next';
import { SignedIn, SignedOut } from '@clerk/nextjs';

export const metadata: Metadata = {
  alternates: {
    canonical: 'https://flaim.app',
  },
};
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { User, Check, ChevronDown } from 'lucide-react';
import { StepConnectPlatforms } from '@/components/site/StepConnectPlatforms';
import { StepConnectAI } from '@/components/site/StepConnectAI';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="py-8 px-4 text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-2">
          Your Fantasy Leagues + Your AI
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Connect ESPN, Yahoo, and Sleeper leagues to Claude, ChatGPT, and Gemini. Get real advice based on your league, your team, your waiver wire, and more.
        </p>
      </section>

      <p className="text-sm text-muted-foreground max-w-xl mx-auto text-center px-4 pb-2">
        Flaim connects your ESPN, Yahoo, and Sleeper fantasy leagues to Claude, ChatGPT, and Gemini for read-only, league-specific analysis. Ask about your roster, matchups, standings, free agents, and transactions — using your actual league data.
      </p>

      {/* What you can ask */}
      <section className="px-4 pb-4">
        <div className="container max-w-xl mx-auto">
          <h2 className="text-lg font-semibold text-center mb-3">What you can ask</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border bg-background p-3">
              <p className="text-sm font-medium">&ldquo;Who should I start this week?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Pulls your real matchup and roster</p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-sm font-medium">&ldquo;Who&rsquo;s on the waiver wire?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Scans available free agents in your league</p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-sm font-medium">&ldquo;How do I stack up against first place?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Compares your roster to the standings leader</p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-sm font-medium">&ldquo;What trades happened this week?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Shows recent transactions in your league</p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-8 bg-muted">
        <div className="container max-w-xl mx-auto px-4">
          <div className="flex flex-col gap-4">
            {/* Step 1: Create Account */}
            <Card className="p-5 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  1
                </div>
                <h3 className="font-semibold text-lg">Make an account</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                First create a Flaim account. This is the glue.
              </p>
              <SignedOut>
                <Link href="/sign-up">
                  <Button className="w-full">
                    <User className="h-4 w-4 mr-2" />
                    Create Account
                  </Button>
                </Link>
              </SignedOut>
              <SignedIn>
                <div className="flex items-center justify-center gap-2 h-8 rounded-md px-3 text-xs font-medium w-full bg-muted text-muted-foreground">
                  <Check className="h-3.5 w-3.5" />
                  Signed in
                </div>
              </SignedIn>
            </Card>

            {/* Step 2: Connect Platforms */}
            <StepConnectPlatforms />

            {/* Step 3: Connect AI */}
            <StepConnectAI />

            {/* Completion message */}
            <p className="text-center text-sm text-muted-foreground pt-2">
              Boom, you&apos;re done. Chat as normal and Flaim will activate automatically based on context. Edit and manage defaults in Your Leagues above. Flaim is read-only, so nothing in your league can automatically change.
            </p>
          </div>
        </div>
      </section>

      {/* FAQs */}
      <section className="py-8 px-4">
        <div className="container max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-5">FAQs</h2>
          <div className="space-y-3">
            {/* What does Flaim do */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                What does Flaim do?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Flaim is a skill that turns your AI into a fantasy sports expert, and a connector to data from your actual fantasy leagues. It lets you ask Claude, ChatGPT, or Gemini about your actual roster, matchup, standings, transactions, available free agents, waiver wire, and more.</p>
              </div>
            </details>

            {/* Why a Chrome extension */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Why a Chrome extension?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>You only need it if you have leagues at ESPN. Log in to fantasy.espn.com and the extension will piggyback on that session to auto-sync your leagues.</p>
              </div>
            </details>

            {/* How does AI connection work */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                How does Flaim connect to AI clients?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Sync your league data to Flaim, and then Flaim connects that data to Claude, ChatGPT, or Gemini. In other words, your Flaim account tells your AI about your leagues, team name, and season year, while also giving the AI dedicated tools to pull out league data.</p>
              </div>
            </details>

            {/* Tips and tricks */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Any other tips or tricks?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Set a default sport and default leagues at flaim.app/leagues to save yourself some repeated explanation. If the AI needs a nudge, just say &ldquo;Use Flaim.&rdquo;</p>
              </div>
            </details>

          </div>
        </div>
      </section>

    </div>
  );
}
