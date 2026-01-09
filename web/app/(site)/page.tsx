import { SignedIn, SignedOut } from '@clerk/nextjs';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MessageSquare, Shield, Lock, User, Check, Link as LinkIcon } from 'lucide-react';
import { StepSyncEspn } from '@/components/site/StepSyncEspn';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="py-16 px-4 text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Fantasy Sports Data for AI
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Connect ESPN fantasy leagues to Claude or ChatGPT.
          Ask questions about your teams, rosters, and matchups.
        </p>
      </section>

      {/* How It Works */}
      <section className="py-16 bg-muted">
        <div className="container max-w-4xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-10">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {/* Step 1: Create Account */}
            <div className="bg-background rounded-xl p-6 border flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  1
                </div>
                <h3 className="font-semibold text-lg">Create Account</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4 flex-1">
                Sign up to get started. This is where your ESPN credentials and league info will be stored.
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
                <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                  <Check className="h-4 w-4" />
                  Signed in
                </div>
              </SignedIn>
            </div>

            {/* Step 2: Sync ESPN */}
            <StepSyncEspn />

            {/* Step 3: Connect AI */}
            <div className="bg-background rounded-xl p-6 border flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  3
                </div>
                <h3 className="font-semibold text-lg">Connect Your AI</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4 flex-1">
                Add the MCP connector to Claude or ChatGPT. Then ask questions about your leagues.
              </p>
              <SignedOut>
                <Button className="w-full" variant="outline" disabled>
                  <LinkIcon className="h-4 w-4 mr-2" />
                  Sign in first
                </Button>
              </SignedOut>
              <SignedIn>
                <Link href="/connectors">
                  <Button className="w-full" variant="outline">
                    <LinkIcon className="h-4 w-4 mr-2" />
                    Get Connector
                  </Button>
                </Link>
              </SignedIn>
            </div>
          </div>
        </div>
      </section>

      {/* What Can You Ask */}
      <section className="py-16 px-4">
        <div className="container max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-3">Example Questions</h2>
          <p className="text-center text-muted-foreground mb-8">
            Once connected, you can ask things like:
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              "Who should I start this week?",
              "Compare my roster to my opponent",
              "Which waiver pickups are worth grabbing?",
              "How's my team doing vs the league?",
              "What trades make sense for my roster?",
              "Break down my matchup for this week",
            ].map((question) => (
              <div
                key={question}
                className="flex items-center gap-3 bg-muted rounded-lg p-4"
              >
                <MessageSquare className="h-5 w-5 text-primary flex-shrink-0" />
                <span className="text-sm">{question}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Works With */}
      <section className="py-16 bg-muted px-4">
        <div className="container max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-6">Works With</h2>
          <div className="flex flex-col sm:flex-row justify-center gap-4 mb-4">
            <div className="px-6 py-4 bg-background rounded-xl border-2 border-primary">
              <div className="font-medium text-lg">Claude</div>
              <div className="text-xs text-primary mt-1">Ready today</div>
            </div>
            <div className="px-6 py-4 bg-background rounded-xl border">
              <div className="font-medium text-lg">ChatGPT</div>
              <div className="text-xs text-muted-foreground mt-1">Dev mode only</div>
            </div>
            <div className="px-6 py-4 bg-background rounded-xl border">
              <div className="font-medium text-lg">Gemini</div>
              <div className="text-xs text-muted-foreground mt-1">Allegedly coming soon</div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Bring your own AI subscription. Flaim just connects the fantasy data.
          </p>
        </div>
      </section>

      {/* Supported Sports */}
      <section className="py-12 px-4">
        <div className="container max-w-4xl mx-auto text-center">
          <h2 className="text-xl font-bold mb-4">Currently Supported</h2>
          <div className="flex justify-center gap-10 mb-3">
            <div className="text-center">
              <div className="text-3xl mb-1">{'\u{1F3C8}'}</div>
              <div className="text-sm font-medium">Football</div>
            </div>
            <div className="text-center">
              <div className="text-3xl mb-1">{'\u26BE'}</div>
              <div className="text-sm font-medium">Baseball</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            ESPN Fantasy only for now. More platforms eventually.
          </p>
        </div>
      </section>

      {/* Security & Trust */}
      <section className="py-16 bg-muted px-4">
        <div className="container max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8">How It Handles Your Data</h2>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-background border flex items-center justify-center mx-auto mb-3">
                <Lock className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-1">Credentials Stay Here</h3>
              <p className="text-sm text-muted-foreground">
                ESPN cookies are stored securely and never sent to the AI.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-background border flex items-center justify-center mx-auto mb-3">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-1">Your AI, Your Account</h3>
              <p className="text-sm text-muted-foreground">
                You use your own Claude or ChatGPT subscription. Flaim just connects the data.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-background border flex items-center justify-center mx-auto mb-3">
                <User className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-1">Solo Project</h3>
              <p className="text-sm text-muted-foreground">
                Built and maintained by one person. No investors, no growth pressure.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="py-12 px-4 text-center">
        <p className="text-sm text-muted-foreground max-w-lg mx-auto">
          Flaim is a side project — built for reliability, maintained for the long term.
          The goal is to do one thing well.{' '}
          <Link href="/inspirations" className="underline hover:text-foreground">
            Inspirations
          </Link>
        </p>
      </section>

      {/* Footer CTA */}
      <section className="py-16 bg-muted px-4 text-center">
        <h2 className="text-2xl font-bold mb-4">Want to try it?</h2>
        <p className="text-muted-foreground mb-6">
          Setup takes a few minutes.
        </p>
        <SignedOut>
          <Link href="/sign-up">
            <Button size="lg">Create Account</Button>
          </Link>
        </SignedOut>
        <SignedIn>
          <Link href="/extension">
            <Button size="lg">Set Up Extension</Button>
          </Link>
        </SignedIn>
      </section>
    </div>
  );
}
