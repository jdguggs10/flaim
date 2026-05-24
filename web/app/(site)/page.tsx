import type { Metadata } from "next";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { PublicChatExperience } from "@/components/public-demo/public-chat-experience";
import { HeroChat } from "@/components/site/hero-chat";

export const metadata: Metadata = {
  title: "Flaim — Fantasy Leagues for ChatGPT",
  description:
    "Flaim Fantasy is available in ChatGPT. Connect ESPN, Yahoo, and Sleeper leagues for read-only fantasy analysis.",
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
import { CHATGPT_APP_URL } from "@/lib/product-links";
import {
  ArrowRight,
  ChevronDown,
  ExternalLink,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

interface LandingPageProps {
  searchParams?: Promise<{
    preset?: string | string[];
  }>;
}

const SUPPORTED_PLATFORMS = ["ESPN", "Yahoo", "Sleeper"] as const;
const SUPPORTED_SPORTS = [
  "Football",
  "Baseball",
  "Basketball",
  "Hockey",
] as const;
const SUPPORTED_AI_TOOLS = ["ChatGPT"] as const;

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
                  text: "Only for ESPN. The Flaim Chrome extension syncs your ESPN cookies automatically so Flaim can read your private leagues. Yahoo connects through OAuth, and Sleeper just needs your username. After that, ChatGPT can use your connected Flaim account for read-only fantasy analysis.",
                },
              },
              {
                "@type": "Question",
                name: "Which AI apps work with Flaim?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Flaim Fantasy is available in ChatGPT. Connect your leagues in Flaim, then open ChatGPT and use Flaim Fantasy for read-only fantasy analysis.",
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
                  text: "Use flaim.app/leagues to connect ESPN, Yahoo, and Sleeper, then open Flaim Fantasy in ChatGPT.",
                },
              },
            ],
          }),
        }}
      />

      <HeroChat />

      <PublicChatExperience
        id="live-demo"
        initialPresetId={initialPresetId ?? null}
      />

      <section
        className="px-4 pb-10 pt-2 sm:px-6 lg:px-8"
        aria-label="Flaim platform, sport, and AI support"
      >
        <div className="mx-auto grid max-w-5xl gap-4 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-2xl border bg-background/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
              Platforms
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUPPORTED_PLATFORMS.map((platform) => (
                <span
                  key={platform}
                  className="rounded-full border bg-background px-3 py-1"
                >
                  {platform}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border bg-background/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
              Sports
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUPPORTED_SPORTS.map((sport) => (
                <span
                  key={sport}
                  className="rounded-full border bg-background px-3 py-1"
                >
                  {sport}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border bg-background/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
              Works With
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUPPORTED_AI_TOOLS.map((tool) => (
                <span
                  key={tool}
                  className="rounded-full border bg-background px-3 py-1"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Primary CTA */}
      <section className="px-4 pb-10 text-center">
        <div className="flex flex-row flex-wrap items-center justify-center gap-3">
          <SignedOut>
            <Button asChild size="lg">
              <Link href="/leagues">Connect leagues now</Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button asChild size="lg">
              <Link href="/leagues">Your Leagues</Link>
            </Button>
          </SignedIn>
          <Button asChild variant="outline" size="lg">
            <a
              href={CHATGPT_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              ChatGPT App Store
              <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </section>

      {/* What You Can Ask */}
      <section className="py-10 px-4 bg-muted">
        <div className="container max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">
            What you can ask
          </h2>
          <p className="text-center text-muted-foreground mb-8">
            Start simple.
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
            Combine your league data and web search for even better insights.
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
              Read-Only
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Flaim can inspect your data, but it cannot make trades, drop
              players, or change anything in your leagues.
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              Multi-League Support
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              One account can support multiple leagues across multiple
              platforms (ESPN, Yahoo, and Sleeper) at the same time.
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <div className="flex items-center gap-2 font-medium">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              Set defaults
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
                  username. ChatGPT uses the league data you connect here.
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
                  Flaim Fantasy is available in ChatGPT. Connect your ESPN,
                  Yahoo, or Sleeper leagues in Flaim, then open ChatGPT and ask
                  a question about your league.
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
                  to connect ESPN, Yahoo, and Sleeper, then open Flaim Fantasy
                  in ChatGPT. The{" "}
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
                  shows how to start using Flaim Fantasy in ChatGPT.
                </p>
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* Setup CTA */}
      <section className="py-10 px-4 bg-muted">
        <div className="container max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-2">
            Ready to connect your leagues?
          </h2>
          <div className="mt-6 flex flex-row flex-wrap items-center justify-center gap-3">
            <SignedOut>
              <Button asChild size="lg">
                <Link href="/leagues">Connect leagues now</Link>
              </Button>
            </SignedOut>
            <SignedIn>
              <Button asChild size="lg">
                <Link href="/leagues">Your Leagues</Link>
              </Button>
            </SignedIn>
            <Button asChild variant="outline" size="lg">
              <Link href="/guide">Help</Link>
            </Button>
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
    </div>
  );
}
