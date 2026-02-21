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
          Fantasy League Analysis Across ESPN, Yahoo, and Sleeper
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Use your AI to evaluate standings, rosters, matchups, and free agents with unified league context and read-only access.
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
                Sign up to get started. This is where your platform credentials and league info will be stored.
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
              Once connected, ask normal fantasy questions in your AI client. Flaim is read-only and cannot modify league data.
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
                <p>Flaim gives you a read-only fantasy analysis workflow across ESPN, Yahoo, and Sleeper. It returns league-aware standings, roster, matchup, and free-agent context so you can make lineup and waiver decisions faster.</p>
              </div>
            </details>

            {/* How does the extension work */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                How does the extension work?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>The extension syncs ESPN session credentials that already exist in your browser after you log into ESPN. Flaim uses them only for read-only retrieval, and you can re-sync when ESPN credentials expire.</p>
              </div>
            </details>

            {/* How does AI connection work */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                How does Flaim connect to AI clients?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Flaim uses a remote MCP endpoint with OAuth authorization. You connect your AI client, approve access, then use normal prompts to retrieve read-only league context.</p>
              </div>
            </details>

            {/* Tips and tricks */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Any other tips or tricks?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Set a default league at <code>/leagues</code> for faster prompts, and if a platform token expires, reconnect and retry. Flaim only supports read operations.</p>
              </div>
            </details>

          </div>
        </div>
      </section>

    </div>
  );
}
