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
import { User, Check, ChevronDown, Brain, Search, Zap } from 'lucide-react';
import { StepConnectPlatforms } from '@/components/site/StepConnectPlatforms';
import { StepConnectAI } from '@/components/site/StepConnectAI';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: [
              {
                '@type': 'Question',
                name: 'What does Flaim do?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Flaim is a skill that turns your AI into a fantasy sports expert, and a connector to data from your actual fantasy leagues. It lets you ask Claude, ChatGPT, or Gemini about your actual roster, matchup, standings, transactions, available free agents, waiver wire, and more.',
                },
              },
              {
                '@type': 'Question',
                name: 'Why a Chrome extension?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'You only need it if you have leagues at ESPN. Log in to fantasy.espn.com and the extension will piggyback on that session to auto-sync your leagues.',
                },
              },
              {
                '@type': 'Question',
                name: 'How does Flaim connect to AI clients?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Sync your league data to Flaim, and then Flaim connects that data to Claude, ChatGPT, or Gemini. Your Flaim account tells your AI about your leagues, team name, and season year, while also giving the AI dedicated tools to pull out league data.',
                },
              },
              {
                '@type': 'Question',
                name: 'Any other tips or tricks?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Set a default sport and default leagues at flaim.app/leagues to save yourself some repeated explanation. If the AI needs a nudge, just say "Use Flaim."',
                },
              },
            ],
          }),
        }}
      />
      {/* Hero */}
      <section className="py-10 px-4 text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          AI for Your Fantasy Leagues
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
          Connect ESPN, Yahoo, and Sleeper leagues to Claude, ChatGPT, and Gemini.
        </p>
        <p className="sr-only">
          Flaim is a free, open-source MCP server that gives Claude, ChatGPT, and Gemini read-only access to your actual fantasy league data: rosters, standings, matchups, free agents, and transactions across football, baseball, basketball, and hockey. It works with ESPN, Yahoo, and Sleeper. Setup takes about 5 minutes, and nothing in your league can be changed.
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

      {/* The Skill */}
      <section className="py-10 px-4">
        <div className="container max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">The Flaim Skill</h2>
          <p className="text-center text-muted-foreground mb-8">
            More than a data connection. Flaim teaches your AI how to think about fantasy sports.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col items-center text-center p-4">
              <Brain className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold mb-1">Fantasy analyst reasoning</h3>
              <p className="text-sm text-muted-foreground">
                Knows how to evaluate rosters, spot weaknesses, and give advice grounded in your league&apos;s format and scoring.
              </p>
            </div>
            <div className="flex flex-col items-center text-center p-4">
              <Search className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold mb-1">Web search when it matters</h3>
              <p className="text-sm text-muted-foreground">
                Knows when to search the web for injury news, schedules, and real-time stats instead of relying on league data alone.
              </p>
            </div>
            <div className="flex flex-col items-center text-center p-4">
              <Zap className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold mb-1">Smart tool orchestration</h3>
              <p className="text-sm text-muted-foreground">
                Decides which tools to call and in what order based on your question. One prompt can pull from multiple sources.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What You Can Ask */}
      <section className="py-10 px-4 bg-muted">
        <div className="container max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">What you can ask</h2>
          <p className="text-center text-muted-foreground mb-8">
            Each example maps to a single tool. One question, one answer.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;What fantasy leagues do I have?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Your connected leagues across platforms</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;Show me my roster&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Team roster with player stats</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;Who am I playing this week?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Weekly matchup and scores</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;What are the standings?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">League rankings</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;Who&rsquo;s on the waiver wire?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Available free agents by ownership</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;Look up Ja&rsquo;Marr Chase&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Player search with ownership context</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;What trades happened this week?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Recent transactions in your league</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;Show me my league settings&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Scoring format, roster slots, and members</p>
            </div>
            <div className="rounded-lg border bg-background p-4 sm:col-span-2 sm:max-w-sm sm:mx-auto">
              <p className="font-medium">&ldquo;How did my team do in 2023?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Historical leagues and past seasons</p>
            </div>
          </div>
        </div>
      </section>

      {/* Go Deeper */}
      <section className="py-10 px-4">
        <div className="container max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">Go deeper</h2>
          <p className="text-center text-muted-foreground mb-8">
            The skill combines tools and web search to answer complex questions.
          </p>
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;Who are the best available players for my biggest roster weakness?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Roster analysis + free agent search</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;Should I start Ja&rsquo;Marr Chase this week?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Roster + web search for injury and matchup news</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;Compare my team to my opponent&rsquo;s. Where do I have an edge?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Matchup + roster + web search for player outlooks</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;Should I drop anyone for a waiver pickup?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Roster + free agents + standings context</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;Is it worth trading for Saquon Barkley?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Player search + roster fit + web search for trade value</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <p className="font-medium">&ldquo;What moves have my rivals made recently?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Transactions + standings</p>
            </div>
          </div>
        </div>
      </section>

      {/* Share */}
      <section className="py-10 px-4 bg-muted">
        <div className="container max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-2">Using Flaim for something amazing?</h2>
          <p className="text-muted-foreground">
            I&apos;d love to hear about it.{' '}
            <a
              href="https://www.threads.com/@jdguggs10"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Share it with me on Threads
            </a>
            .
          </p>
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
