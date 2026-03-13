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
          Your Fantasy League, Inside Your AI
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Connect your ESPN, Yahoo, and Sleeper leagues to Claude, ChatGPT, and Gemini. Ask about your actual team, matchup, standings, and waiver wire, and get answers grounded in your league.
        </p>
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
                <h3 className="font-semibold text-lg">Create Account</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Sign up to save your connected platforms, leagues, and AI access in one place.
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
              Once connected, ask normal fantasy questions in your AI client. Flaim is read-only, so nothing in your league gets changed.
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
                <p>Flaim lets you ask Claude, ChatGPT, or Gemini about your real fantasy team. It pulls in your roster, matchup, standings, and waiver wire so the answers are about your league, not generic rankings.</p>
              </div>
            </details>

            {/* How does the extension work */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                How does the extension work?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>After you log into ESPN in Chrome, the extension securely syncs the session Flaim needs to read your league data. It cannot make changes in ESPN, and you can re-sync anytime your session expires.</p>
              </div>
            </details>

            {/* How does AI connection work */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                How does Flaim connect to AI clients?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>You add Flaim in Claude, ChatGPT, or Gemini, approve access to your account, and then ask normal questions. Under the hood it uses MCP, but from your side it should feel like connecting any other AI tool.</p>
              </div>
            </details>

            {/* Tips and tricks */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Any other tips or tricks?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Set a default league at <code>/leagues</code> so your prompts can stay short. If a platform connection expires, reconnect and retry. Flaim can advise on adds, drops, starts, and trades without making those moves for you.</p>
              </div>
            </details>

          </div>
        </div>
      </section>

    </div>
  );
}
