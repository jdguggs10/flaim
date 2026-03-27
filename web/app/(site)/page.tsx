import type { Metadata } from 'next';
import { SignedOut } from '@clerk/nextjs';
import { PublicChatExperience } from '@/components/public-demo/public-chat-experience';

export const metadata: Metadata = {
  alternates: {
    canonical: 'https://flaim.app',
  },
};
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  PUBLIC_CHAT_DEEP_PRESETS,
  PUBLIC_CHAT_SIMPLE_PRESETS,
  PUBLIC_CHAT_TOOL_DISPLAY_LABELS,
} from '@/lib/public-chat';
import { ArrowRight, ChevronDown, Brain, Search, ShieldCheck, Sparkles, Zap } from 'lucide-react';

interface LandingPageProps {
  searchParams?: Promise<{
    preset?: string | string[];
  }>;
}

function getDemoHref(presetId: string) {
  return `/?preset=${presetId}#live-demo`;
}

export default async function LandingPage({ searchParams }: LandingPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const preset = resolvedSearchParams?.preset;
  const initialPresetId = Array.isArray(preset) ? preset[0] : preset;
  const homepageSimplePresets = PUBLIC_CHAT_SIMPLE_PRESETS;
  const homepageDeepPresets = PUBLIC_CHAT_DEEP_PRESETS;

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
                name: 'Do I need a Chrome extension?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Only for ESPN. Yahoo uses OAuth, Sleeper uses your username, and your AI assistant connects through Flaim after your leagues are linked.',
                },
              },
              {
                '@type': 'Question',
                name: 'Which AI apps work with Flaim?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Flaim works with Claude, ChatGPT, and Perplexity today. Gemini and Grok are not available yet.',
                },
              },
              {
                '@type': 'Question',
                name: 'Can Flaim change anything in my leagues?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'No. Flaim is read-only. It can inspect your leagues, rosters, standings, transactions, and free agents, but it cannot make trades, add players, or change league settings.',
                },
              },
              {
                '@type': 'Question',
                name: 'Where do I finish setup?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Use flaim.app/leagues to connect platforms, copy your MCP setup details, and set defaults for your favorite sport or team.',
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
            Read-only Fantasy Analysis
          </p>
          <h1 className="mb-4 text-4xl font-bold md:text-6xl">
            Your real fantasy leagues,
            <span className="block text-muted-foreground">connected to your AI.</span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground md:text-xl">
            Flaim connects ESPN, Yahoo, and Sleeper to Claude, ChatGPT, and Perplexity, giving the AI you already use your real roster, matchups, standings, waiver wire, and league activity.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <SignedOut>
              <Button asChild size="lg">
                <Link href="/leagues">Set up Flaim</Link>
              </Button>
            </SignedOut>
          </div>
        </div>
        <p className="sr-only">
          Flaim is a free, open-source MCP server that gives Claude, ChatGPT, and Perplexity read-only access to your actual fantasy league data: rosters, standings, matchups, free agents, and transactions across football, baseball, basketball, and hockey. It works with ESPN, Yahoo, and Sleeper. Setup takes about 5 minutes, and nothing in your league can be changed.
        </p>
      </section>

      <PublicChatExperience
        id="live-demo"
        initialPresetId={initialPresetId ?? null}
      />

      <section className="px-4 pb-10 pt-2 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-4 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-2xl border bg-background/70 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
              Platforms supported
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border bg-background px-3 py-1">ESPN</span>
              <span className="rounded-full border bg-background px-3 py-1">Yahoo</span>
              <span className="rounded-full border bg-background px-3 py-1">Sleeper</span>
            </div>
          </div>
          <div className="rounded-2xl border bg-background/70 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
              Sports supported
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border bg-background px-3 py-1">Football</span>
              <span className="rounded-full border bg-background px-3 py-1">Baseball</span>
              <span className="rounded-full border bg-background px-3 py-1">Basketball</span>
              <span className="rounded-full border bg-background px-3 py-1">Hockey</span>
            </div>
          </div>
          <div className="rounded-2xl border bg-background/70 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
              AI supported
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border bg-background px-3 py-1">Claude</span>
              <span className="rounded-full border bg-background px-3 py-1">ChatGPT</span>
              <span className="rounded-full border bg-background px-3 py-1">Perplexity</span>
            </div>
          </div>
        </div>
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
                Add Flaim to Claude, ChatGPT, or Perplexity using the MCP details from your account and authorize the connection once.
              </p>
            </Card>
            <Card className="p-5">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
                3
              </div>
              <h3 className="text-lg font-semibold">Ask league-specific questions</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Ask about your roster, waiver wire, matchups, or rivals. Flaim grounds the answer in your actual leagues and adds web context when needed.
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
                Set defaults once
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Use <Link href="/leagues" className="text-primary hover:underline">Your Leagues</Link> to save a default sport and favorite league so your AI needs less hand-holding.
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
            Start simple. These quick prompts each show off one core Flaim capability.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {homepageSimplePresets.map((preset) => (
              <Link
                key={preset.id}
                href={getDemoHref(preset.id)}
                className="group rounded-lg border bg-background p-4 transition-colors hover:border-foreground/20"
              >
                {preset.toolLabel ? (
                  <div className="mb-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {preset.toolLabel}
                  </div>
                ) : null}
                <p className="font-medium">&ldquo;{preset.userMessage}&rdquo;</p>
                <div className="mt-3 flex items-center gap-2 text-xs font-medium text-primary">
                  <span>Run this live in the demo</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Go Deeper */}
      <section className="py-10 px-4">
        <div className="container max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">Go deeper</h2>
          <p className="text-center text-muted-foreground mb-8">
            Start with the basic tools above. These deeper prompts combine multiple Flaim tools and live web context to produce stronger answers.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {homepageDeepPresets.map((preset) => (
              <Link
                key={preset.id}
                href={getDemoHref(preset.id)}
                className="group rounded-lg border bg-background p-4 transition-colors hover:border-foreground/20"
              >
                <p className="font-medium">&ldquo;{preset.userMessage}&rdquo;</p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {preset.homepageExplanation}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {preset.allowedTools.map((tool) => (
                    <span
                      key={tool}
                      className="inline-flex rounded-full border bg-muted px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      {PUBLIC_CHAT_TOOL_DISPLAY_LABELS[tool]}
                    </span>
                  ))}
                  <span className="inline-flex rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-primary">
                    Web Search
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs font-medium text-primary">
                  <span>Run this live in the demo</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
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
                Do I need a Chrome extension?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Only for ESPN. Yahoo uses OAuth, Sleeper uses your username, and your AI assistant connects through Flaim after your leagues are linked.</p>
              </div>
            </details>

            {/* Supported AI apps */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Which AI apps work with Flaim?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Claude, ChatGPT, and Perplexity today. Gemini and Grok are not available yet.</p>
              </div>
            </details>

            {/* Read-only trust */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Can Flaim change anything in my leagues?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>No. Flaim is read-only. It can inspect your leagues, rosters, standings, transactions, and free agents, but it cannot make trades, add players, or change league settings.</p>
              </div>
            </details>

            {/* Setup location */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Where do I finish setup?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Use <Link href="/leagues" className="text-primary hover:underline">Your Leagues</Link> to connect platforms, copy your MCP setup details, and set defaults for your favorite sport or team.</p>
              </div>
            </details>

          </div>
        </div>
      </section>

    </div>
  );
}
