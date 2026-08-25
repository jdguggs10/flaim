import type { Metadata } from "next";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { PublicChatExperience } from "@/components/public-demo/public-chat-experience";
import { HeroChat } from "@/components/site/hero-chat";
import { HomepageProductProof } from "@/components/site/homepage-product-proof";
import { YahooOutagePill } from "@/components/site/yahoo-outage-pill";

export const metadata: Metadata = {
  title: {
    absolute: "Flaim Fantasy | Your Real Fantasy Leagues in AI",
  },
  description:
    "Connect ESPN, Yahoo, or Sleeper fantasy leagues to ChatGPT or Claude with Flaim. Ask about your real roster, matchup, standings, waiver wire, recent moves, and league history without screenshots.",
  alternates: {
    canonical: "https://flaim.app",
  },
};
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  CHATGPT_APP_URL,
  CLAUDE_CONNECTOR_DIRECTORY_URL,
} from "@/lib/product-links";
import {
  ArrowRight,
  ChevronDown,
  CircleDollarSign,
  ShieldCheck,
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
const SUPPORTED_AI_TOOLS = ["ChatGPT", "Claude", "Perplexity"] as const;

function HomepageCtas({ closing = false }: { closing?: boolean }) {
  const connectLabel = closing
    ? "Connect Your Leagues to Flaim"
    : "First, Connect Your Leagues";
  const chatGptLabel = closing
    ? "Connect Flaim to ChatGPT"
    : "Add to ChatGPT";
  const claudeLabel = closing ? "Connect Flaim to Claude" : "Add to Claude";
  const containerClassName = closing
    ? "mx-auto grid w-full max-w-xl gap-3 sm:grid-cols-2"
    : "mx-auto grid w-full max-w-sm grid-cols-2 items-center justify-center gap-3 sm:flex sm:max-w-none sm:flex-row sm:flex-wrap";
  const primaryClassName = closing
    ? "w-full sm:col-span-2"
    : "col-span-2 w-full sm:w-auto";
  const secondaryClassName = closing ? "w-full" : "w-full sm:w-auto";

  return (
    <div className={containerClassName}>
      <SignedOut>
        <Button asChild size="lg" className={primaryClassName}>
          <Link href="/leagues">{connectLabel}</Link>
        </Button>
      </SignedOut>
      <SignedIn>
        <Button asChild size="lg" className={primaryClassName}>
          <Link href="/leagues">Your Leagues</Link>
        </Button>
      </SignedIn>
      <Button
        asChild
        variant="outline"
        size="lg"
        className={secondaryClassName}
      >
        <a
          href={CHATGPT_APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open Flaim Fantasy in ChatGPT"
          title="Open Flaim Fantasy in the ChatGPT Plugin Store"
        >
          {chatGptLabel}
        </a>
      </Button>
      <Button
        asChild
        variant="outline"
        size="lg"
        className={secondaryClassName}
      >
        <a
          href={CLAUDE_CONNECTOR_DIRECTORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Find Flaim in Claude"
          title="Find Flaim in Claude's connector directory"
        >
          {claudeLabel}
        </a>
      </Button>
    </div>
  );
}

export default async function LandingPage({ searchParams }: LandingPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const preset = resolvedSearchParams?.preset;
  const initialPresetId = Array.isArray(preset) ? preset[0] : preset;
  const showScreenshotPlaceholders = process.env.NODE_ENV === "development";

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
                name: "Is there a subscription?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Flaim is free to use and has no subscription, plus, premium, pro plus premium anything. I have some server costs, but everything is manageable right now. Enjoy.",
                },
              },
              {
                "@type": "Question",
                name: "Can ChatGPT directly access my fantasy league?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Yes. Flaim enables your AI to access your league data, read-only. Once you sync your leagues to Flaim, your AI will securely get up-to-date, accurate information on your private leagues.",
                },
              },
              {
                "@type": "Question",
                name: "Do I need to upload screenshots or type out my roster?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "No. Connect your fantasy platforms once, and Flaim connects your league info directly.",
                },
              },
              {
                "@type": "Question",
                name: "Do I need the Chrome extension?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Only for initial ESPN setup. Yahoo connects through Yahoo sign-in, and Sleeper connects with your username. Sync your ESPN credentials once, and Flaim will access your ESPN league from your phone, on the road, anywhere.",
                },
              },
              {
                "@type": "Question",
                name: "Which AI apps work with Flaim?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Flaim Fantasy is officially available in both ChatGPT's Plugin Store and Claude's Connector Directory. Perplexity and other AIs can also be manually connected as custom connectors (see docs).",
                },
              },
              {
                "@type": "Question",
                name: "Can Flaim change anything in my leagues?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "No. Flaim cannot make trades, add or drop players, edit lineups, or change settings in ESPN, Yahoo, or Sleeper.",
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

      {/* FLA-290: temporary note pointing out the football demo lanes are
          staged but not yet live. Self-contained — safe to delete this
          paragraph once ESPN/Sleeper football targets go live in the
          live-demo capabilities feed. */}
      <p className="mx-auto max-w-md px-4 pb-8 text-center text-sm text-muted-foreground">
        Football demos are on the way — ESPN and Sleeper league previews land
        as soon as drafts wrap up.
      </p>

      <section
        className="px-4 pb-10 pt-2 sm:px-6 lg:px-8"
        aria-label="Flaim platform, sport, and AI support"
      >
        <div className="mx-auto grid max-w-5xl gap-4 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-2xl border bg-background/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
              Fantasy platforms
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUPPORTED_PLATFORMS.map((platform) =>
                /* FLA-305: Yahoo gets an outage indicator + popover instead
                   of a plain pill while Yahoo API access is down (FLA-237).
                   Revert to the plain span below once that resolves. */
                platform === "Yahoo" ? (
                  <YahooOutagePill key={platform} />
                ) : (
                  <span
                    key={platform}
                    className="rounded-full border bg-background px-3 py-1"
                  >
                    {platform}
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="rounded-2xl border bg-background/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/70">
              Fantasy sports
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
              AI apps
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
        <HomepageCtas />
      </section>

      {/* Seasonal Spotlight */}
      <section className="px-4 py-14 sm:px-6 lg:px-8">
        <div
          className={`mx-auto grid max-w-5xl gap-8 rounded-3xl border bg-background p-6 shadow-sm md:p-9 ${
            showScreenshotPlaceholders ? "md:grid-cols-[1.3fr_0.7fr]" : ""
          }`}
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Fantasy football draft season
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              Just drafted? Get a second opinion on your real team.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              No roster screenshots. No typing every player into a generic team
              grader. Flaim brings your roster and league info with it.
            </p>
            <Button asChild className="mt-6">
              <Link href="/fantasy-football">
                See Fantasy Football Examples
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          {showScreenshotPlaceholders ? (
            <div className="flex min-h-56 items-center justify-center rounded-2xl border border-dashed bg-muted/40 p-6 text-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground/65">
                  Real mobile example
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  An approved, sanitized screenshot will appear here after the
                  capture pass.
                </p>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  Flaim Fantasy analyzing a real connected roster inside an AI
                  app.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <HomepageProductProof />

      {/* Trust badges */}
      <section className="bg-background px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
          <div className="rounded-xl border bg-background p-4">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Read Only
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Flaim can read your fantasy league data, but it cannot make
              trades, add or drop players, edit lineups, or change league
              settings.
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              All Your Leagues
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect multiple leagues across ESPN, Yahoo, and Sleeper, then
              choose which league you want to discuss.
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <div className="flex items-center gap-2 font-medium">
              <CircleDollarSign className="h-4 w-4 text-primary" />
              It&apos;s free
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Flaim has no subscription. You use it through an AI app you
              already have.
            </p>
          </div>
        </div>
      </section>

      {/* FAQs */}
      <section className="py-8 px-4">
        <div className="container max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-5">FAQs</h2>
          <div className="space-y-3">
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Is there a subscription?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-2 px-4 pb-4 text-sm text-muted-foreground">
                <p>
                  Flaim is free to use and has no subscription, plus, premium,
                  pro plus premium anything. I have some server costs, but
                  everything is manageable right now. Enjoy.
                </p>
              </div>
            </details>

            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Can ChatGPT directly access my fantasy league?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-2 px-4 pb-4 text-sm text-muted-foreground">
                <p>
                  Yes. Flaim enables your AI to access your league data,
                  read-only. Once you sync your leagues to Flaim, your AI will
                  securely get up-to-date, accurate information on your private
                  leagues.
                </p>
              </div>
            </details>

            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Do I need to upload screenshots or type out my roster?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-2 px-4 pb-4 text-sm text-muted-foreground">
                <p>
                  No. Connect your fantasy platforms once, and Flaim connects
                  your league info directly.
                </p>
              </div>
            </details>

            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Do I need the Chrome extension?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-2 px-4 pb-4 text-sm text-muted-foreground">
                <p>
                  Only for initial ESPN setup. Yahoo connects through Yahoo
                  sign-in, and Sleeper connects with your username. Sync your
                  ESPN credentials once, and Flaim will access your ESPN league
                  from your phone, on the road, anywhere.
                </p>
              </div>
            </details>

            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Which AI apps work with Flaim?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-2 px-4 pb-4 text-sm text-muted-foreground">
                <p>
                  Flaim Fantasy is officially available in both ChatGPT&apos;s
                  Plugin Store and Claude&apos;s Connector Directory. Perplexity
                  and other AIs can also be manually connected as custom
                  connectors (see{" "}
                  <Link href="/docs/ai" className="text-primary hover:underline">
                    docs
                  </Link>
                  ).
                </p>
              </div>
            </details>

            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Can Flaim change anything in my leagues?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-2 px-4 pb-4 text-sm text-muted-foreground">
                <p>
                  No. Flaim cannot make trades, add or drop players, edit
                  lineups, or change settings in ESPN, Yahoo, or Sleeper.
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
            Ready to ask about your teams?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Create your Flaim account, connect your fantasy leagues, then
            connect your AI app. After that, just start asking.
          </p>
          <div className="mt-6 flex flex-row flex-wrap items-center justify-center gap-3">
            <HomepageCtas closing />
          </div>
        </div>
      </section>

      {/* Founder note */}
      <section id="about-flaim" className="scroll-mt-24 px-4 py-12">
        <div className="container mx-auto max-w-2xl text-center">
          <p className="text-muted-foreground">
            I&apos;m Gerry, and I built Flaim. It&apos;s free to use and my
            passion project. Please don&apos;t abuse it. Have fun.
          </p>
          <p className="mt-4 text-sm">
            <a
              href="https://www.threads.com/@flaim_app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              @flaim_app on Threads
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
