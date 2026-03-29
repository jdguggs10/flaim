import type { Metadata } from "next";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { PublicChatExperience } from "@/components/public-demo/public-chat-experience";

export const metadata: Metadata = {
  title: "Flaim — Connect ESPN, Yahoo & Sleeper Fantasy Leagues to AI",
  description:
    "Flaim gives Claude, ChatGPT, and Perplexity read-only access to your real fantasy league data — rosters, standings, matchups, waiver wire, and transactions across football, baseball, basketball, and hockey.",
  alternates: {
    canonical: "https://flaim.app",
  },
};
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  PUBLIC_CHAT_DEEP_PRESETS,
  PUBLIC_CHAT_SIMPLE_PRESETS,
  PUBLIC_CHAT_TOOL_DISPLAY_LABELS,
} from "@/lib/public-chat";
import {
  ArrowRight,
  ChevronDown,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

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
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              {
                "@type": "Question",
                name: "Do I need a Chrome extension?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Only for ESPN. The Flaim Chrome extension syncs your ESPN cookies automatically so Flaim can read your private leagues. Yahoo connects through OAuth, Sleeper just needs your username, and your AI assistant connects to Flaim separately using a single MCP URL — no extension required for the AI side.",
                },
              },
              {
                "@type": "Question",
                name: "Which AI apps work with Flaim?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Flaim works with Claude, ChatGPT, and Perplexity today using the Model Context Protocol (MCP). You add one URL — https://api.flaim.app/mcp — as a connector in any of these AI apps, authorize once, and Flaim handles the rest.",
                },
              },
              {
                "@type": "Question",
                name: "Can Flaim change anything in my leagues?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "No. Flaim is read-only by design. It can inspect your rosters, standings, matchups, transactions, free agents, player details, league settings, and league history across ESPN, Yahoo, and Sleeper — but it cannot make trades, drop players, change lineups, or modify any league settings. This applies to all platforms and all sports.",
                },
              },
              {
                "@type": "Question",
                name: "Where do I finish setup?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Use flaim.app/leagues to connect your fantasy platforms, then add Flaim to your AI assistant using the MCP URL shown on that page. Setup takes about 5 minutes. The setup guides at flaim.app/guide/platforms and flaim.app/guide/ai walk through each step with troubleshooting tips.",
                },
              },
            ],
          }),
        }}
      />
      {/* Hero */}
      <section className="px-4 py-10 text-center md:py-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-6xl">
            <span className="text-muted-foreground">
              Can you see my fantasy leagues?
            </span>
            <span className="ml-3 text-foreground">Yes.</span>
          </h1>
          <p className="mx-auto max-w-xl text-lg leading-7 text-muted-foreground md:text-[1.35rem]">
            Flaim connects ChatGPT, Claude, and Perplexity to ESPN, Yahoo, and
            Sleeper.
          </p>
        </div>
      </section>

      <PublicChatExperience
        id="live-demo"
        initialPresetId={initialPresetId ?? null}
      />

      <section className="px-4 pb-10 pt-2 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-4 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-2xl border bg-background/70 p-4">
            <Link
              href="/guide/platforms"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70 hover:text-primary transition-colors"
            >
              Platforms
            </Link>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/guide/platforms#espn"
                className="rounded-full border bg-background px-3 py-1 transition-colors hover:border-foreground/30"
              >
                ESPN
              </Link>
              <Link
                href="/guide/platforms#yahoo"
                className="rounded-full border bg-background px-3 py-1 transition-colors hover:border-foreground/30"
              >
                Yahoo
              </Link>
              <Link
                href="/guide/platforms#sleeper"
                className="rounded-full border bg-background px-3 py-1 transition-colors hover:border-foreground/30"
              >
                Sleeper
              </Link>
            </div>
          </div>
          <div className="rounded-2xl border bg-background/70 p-4">
            <Link
              href="/guide/sports"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70 hover:text-primary transition-colors"
            >
              Sports
            </Link>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/guide/sports#football"
                className="rounded-full border bg-background px-3 py-1 transition-colors hover:border-foreground/30"
              >
                Football
              </Link>
              <Link
                href="/guide/sports#baseball"
                className="rounded-full border bg-background px-3 py-1 transition-colors hover:border-foreground/30"
              >
                Baseball
              </Link>
              <Link
                href="/guide/sports#basketball"
                className="rounded-full border bg-background px-3 py-1 transition-colors hover:border-foreground/30"
              >
                Basketball
              </Link>
              <Link
                href="/guide/sports#hockey"
                className="rounded-full border bg-background px-3 py-1 transition-colors hover:border-foreground/30"
              >
                Hockey
              </Link>
            </div>
          </div>
          <div className="rounded-2xl border bg-background/70 p-4">
            <Link
              href="/guide/ai"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70 hover:text-primary transition-colors"
            >
              Works with
            </Link>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/guide/ai#claude"
                className="rounded-full border bg-background px-3 py-1 transition-colors hover:border-foreground/30"
              >
                Claude
              </Link>
              <Link
                href="/guide/ai#chatgpt"
                className="rounded-full border bg-background px-3 py-1 transition-colors hover:border-foreground/30"
              >
                ChatGPT
              </Link>
              <Link
                href="/guide/ai#perplexity"
                className="rounded-full border bg-background px-3 py-1 transition-colors hover:border-foreground/30"
              >
                Perplexity
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Primary CTA */}
      <section className="px-4 pb-10 text-center">
        <SignedOut>
          <Button asChild size="lg">
            <Link href="/leagues">Set up Flaim</Link>
          </Button>
        </SignedOut>
        <SignedIn>
          <Button asChild size="lg">
            <Link href="/leagues">Your Leagues</Link>
          </Button>
        </SignedIn>
      </section>

      {/* What You Can Ask */}
      <section className="py-10 px-4 bg-muted">
        <div className="container max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">
            What you can ask
          </h2>
          <p className="text-center text-muted-foreground mb-8">
            Start simple. These quick prompts each show off one core Flaim
            capability.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {homepageSimplePresets.map((preset) => (
              <Link
                key={preset.id}
                href={getDemoHref(preset.id)}
                className="group flex items-center gap-3 rounded-lg border bg-background px-4 py-3 transition-colors hover:border-foreground/20"
              >
                <p className="flex-1 text-sm font-medium">
                  &ldquo;{preset.homepageLabel ?? preset.userMessage}&rdquo;
                </p>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:text-primary group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Go Deeper */}
      <section className="py-10 px-4">
        <div className="container max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">
            Go deeper
          </h2>
          <p className="text-center text-muted-foreground mb-8">
            These prompts combine multiple Flaim tools and live web context.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {homepageDeepPresets.map((preset) => (
              <Link
                key={preset.id}
                href={getDemoHref(preset.id)}
                className="group flex flex-col rounded-lg border bg-background px-4 py-3 transition-colors hover:border-foreground/20"
              >
                <div className="flex items-center gap-3">
                  <p className="flex-1 text-sm font-medium">
                    &ldquo;{preset.homepageLabel ?? preset.userMessage}&rdquo;
                  </p>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:text-primary group-hover:translate-x-0.5" />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {preset.allowedTools.map((tool) => (
                    <span
                      key={tool}
                      className="inline-flex rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      {PUBLIC_CHAT_TOOL_DISPLAY_LABELS[tool]}
                    </span>
                  ))}
                  <span className="inline-flex rounded-full border border-primary/25 bg-primary/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-primary">
                    Web Search
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Trust badges */}
      <section className="px-4 py-10 sm:px-6 lg:px-8 bg-muted">
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
          <div className="rounded-xl border bg-background p-4">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Read-only by design
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Flaim can inspect your data, but it cannot make trades, drop
              players, or change anything in your leagues.
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              Works across platforms
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              One account can pull from ESPN, Yahoo, and Sleeper instead of
              forcing you to copy stats and standings around by hand.
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <div className="flex items-center gap-2 font-medium">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              Set defaults once
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Use{" "}
              <Link href="/leagues" className="text-primary hover:underline">
                Your Leagues
              </Link>{" "}
              to save a default sport and favorite league so your AI needs less
              hand-holding.
            </p>
          </div>
        </div>
      </section>

      {/* Share */}
      <section className="py-10 px-4">
        <div className="container max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-2">
            Using Flaim for something amazing?
          </h2>
          <p className="text-muted-foreground">
            I&apos;d love to hear about it.{" "}
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

      {/* Setup CTA */}
      <section className="py-10 px-4 bg-muted">
        <div className="container max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-2">
            Ready to connect your leagues?
          </h2>
          <p className="text-muted-foreground mb-6">
            Setup takes about 5 minutes. Connect a platform, add Flaim to your
            AI, and start asking.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <SignedOut>
              <Button asChild size="lg">
                <Link href="/leagues">Set up Flaim</Link>
              </Button>
            </SignedOut>
            <SignedIn>
              <Button asChild size="lg">
                <Link href="/leagues">Your Leagues</Link>
              </Button>
            </SignedIn>
            <Button asChild variant="outline" size="lg">
              <Link href="/guide/platforms">Setup guides</Link>
            </Button>
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
                Do I need a Chrome extension?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>
                  Only for ESPN. The Flaim Chrome extension syncs your ESPN
                  cookies automatically so Flaim can read your private leagues.
                  Yahoo connects through OAuth, Sleeper just needs your
                  username, and your AI assistant connects to Flaim separately
                  using a single MCP URL — no extension required for the AI
                  side.
                </p>
              </div>
            </details>

            {/* Supported AI apps */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Which AI apps work with Flaim?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>
                  Claude, ChatGPT, and Perplexity today using the Model Context
                  Protocol (MCP). You add one URL —{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    https://api.flaim.app/mcp
                  </code>{" "}
                  — as a connector in any of these AI apps, authorize once, and
                  Flaim handles the rest.
                </p>
              </div>
            </details>

            {/* Read-only trust */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Can Flaim change anything in my leagues?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>
                  No. Flaim is read-only by design. It can inspect your rosters,
                  standings, matchups, transactions, free agents, player
                  details, league settings, and league history across ESPN,
                  Yahoo, and Sleeper — but it cannot make trades, drop players,
                  change lineups, or modify any league settings. This applies to
                  all platforms and all sports.
                </p>
              </div>
            </details>

            {/* Setup location */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Where do I finish setup?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>
                  Use{" "}
                  <Link
                    href="/leagues"
                    className="text-primary hover:underline"
                  >
                    Your Leagues
                  </Link>{" "}
                  to connect your fantasy platforms, then add Flaim to your AI
                  assistant using the MCP URL shown on that page. Setup takes
                  about 5 minutes. The{" "}
                  <Link
                    href="/guide/platforms"
                    className="text-primary hover:underline"
                  >
                    platform setup guide
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/guide/ai"
                    className="text-primary hover:underline"
                  >
                    AI setup guide
                  </Link>{" "}
                  walk through each step with troubleshooting tips.
                </p>
              </div>
            </details>
          </div>
        </div>
      </section>
    </div>
  );
}
