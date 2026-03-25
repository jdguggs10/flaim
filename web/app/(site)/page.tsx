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
import { ArrowRight, ChevronDown, Brain, Search, ShieldCheck, Sparkles, Zap } from 'lucide-react';

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
      <section className="px-4 py-12 text-center md:py-16">
        <div className="mx-auto max-w-3xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            Read-only fantasy analysis
          </p>
          <h1 className="mb-4 text-4xl font-bold md:text-6xl">
            Your real fantasy leagues,
            <span className="block text-muted-foreground">inside the AI you already use.</span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground md:text-xl">
            Flaim connects ESPN, Yahoo, and Sleeper to Claude, ChatGPT, and Gemini so the advice is based on your real roster, matchups, standings, waiver wire, and recent moves.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/chat">
                See it live
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <SignedOut>
              <Button asChild size="lg" variant="outline">
                <Link href="/leagues">Set up Flaim</Link>
              </Button>
            </SignedOut>
            <SignedIn>
              <Button asChild size="lg" variant="outline">
                <Link href="/leagues">Go to Leagues</Link>
              </Button>
            </SignedIn>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="rounded-full border bg-background px-3 py-1">ESPN</span>
            <span className="rounded-full border bg-background px-3 py-1">Yahoo</span>
            <span className="rounded-full border bg-background px-3 py-1">Sleeper</span>
            <span className="rounded-full border bg-background px-3 py-1">Claude</span>
            <span className="rounded-full border bg-background px-3 py-1">ChatGPT</span>
            <span className="rounded-full border bg-background px-3 py-1">Gemini</span>
          </div>
        </div>
        <p className="sr-only">
          Flaim is a free, open-source MCP server that gives Claude, ChatGPT, and Gemini read-only access to your actual fantasy league data: rosters, standings, matchups, free agents, and transactions across football, baseball, basketball, and hockey. It works with ESPN, Yahoo, and Sleeper. Setup takes about 5 minutes, and nothing in your league can be changed.
        </p>
      </section>

      {/* How It Works */}
      <section className="bg-muted px-4 py-10">
        <div className="container mx-auto max-w-5xl">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold md:text-3xl">How it works</h2>
            <p className="mt-2 text-muted-foreground">
              Flaim stays simple: connect your leagues, connect your AI, and ask questions as normal.
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Card className="p-5">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                1
              </div>
              <h3 className="text-lg font-semibold">Connect your platforms</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Sync ESPN with the Chrome extension, sign in with Yahoo, or enter your Sleeper username. Flaim pulls in your leagues and seasons from there.
              </p>
            </Card>
            <Card className="p-5">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                2
              </div>
              <h3 className="text-lg font-semibold">Connect your AI</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Add Flaim to Claude, ChatGPT, or Gemini using the MCP URL from your account and authorize the connection once.
              </p>
            </Card>
            <Card className="p-5">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                3
              </div>
              <h3 className="text-lg font-semibold">Ask league-specific questions</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Flaim gives your AI grounded context from your real leagues, then combines it with fantasy-analysis behavior and web search when needed.
              </p>
            </Card>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border bg-background p-4">
              <div className="flex items-center gap-2 font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Read-only by design
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Flaim can inspect your data, but it cannot make trades, drop players, or change anything in your leagues.
              </p>
            </div>
            <div className="rounded-xl border bg-background p-4">
              <div className="flex items-center gap-2 font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                Works across platforms
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                One account can pull from ESPN, Yahoo, and Sleeper instead of forcing you to copy stats and standings around by hand.
              </p>
            </div>
            <div className="rounded-xl border bg-background p-4">
              <div className="flex items-center gap-2 font-medium">
                <ArrowRight className="h-4 w-4 text-primary" />
                Setup lives in one place
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Use <Link href="/leagues" className="text-primary hover:underline">Your Leagues</Link> to connect platforms, copy your AI setup info, and manage defaults.
              </p>
            </div>
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
            Flaim gives your AI nine fantasy league tools.
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
            Ask and you shall receive... skill + tools + web search = magic.
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
