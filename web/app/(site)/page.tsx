import type { Metadata } from "next";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { PublicChatExperience } from "@/components/public-demo/public-chat-experience";
import { HeroChat } from "@/components/site/hero-chat";

export const metadata: Metadata = {
  title: {
    absolute: "Flaim Fantasy — Your Real Fantasy Leagues in AI",
  },
  description:
    "Connect your ESPN, Yahoo, or Sleeper fantasy leagues to the AI you already use. Analyze your real roster, matchups, standings, waiver wire, transactions, and league history—without screenshots or copy-pasting.",
  alternates: {
    canonical: "https://flaim.app",
  },
};
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CHATGPT_APP_URL } from "@/lib/product-links";
import {
  ArrowRight,
  ChevronDown,
  CircleDollarSign,
  ExternalLink,
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
const SUPPORTED_AI_TOOLS = [
  "ChatGPT",
  "Claude (soon)",
  "Perplexity (soon)",
] as const;

const HOMEPAGE_PROMPT_PLACEHOLDERS = [
  {
    question: "What are the biggest strengths and weaknesses of my roster?",
    tools: ["Roster", "Standings"],
  },
  {
    question: "Who should I add from my waiver wire?",
    tools: ["Free Agents", "Players"],
  },
  {
    question: "How does this week's matchup look?",
    tools: ["Matchups", "Roster"],
  },
  {
    question: "Grade my last trade.",
    tools: ["Transactions", "Roster", "Players"],
  },
  {
    question: "Which league settings matter most for my strategy?",
    tools: ["League Info"],
  },
  {
    question: "How has my team changed this season?",
    tools: ["Transactions", "Roster"],
  },
  {
    question: "Do I have the best team in the league?",
    tools: ["Standings", "Roster"],
  },
  {
    question: "What happened in past seasons?",
    tools: ["League History"],
  },
] as const;

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
                name: "Can ChatGPT access my fantasy league?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Yes. First, create a Flaim account. Second, connect your league to Flaim. Third, connect Flaim in your AI app. That's it. Flaim bridges your AI app to your fantasy leagues and back again.",
                },
              },
              {
                "@type": "Question",
                name: "Do I need to upload screenshots or type out my roster?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "No. Connect your fantasy platforms once, and Flaim supplies the league data on demand.",
                },
              },
              {
                "@type": "Question",
                name: "Is Flaim free?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Yes. Flaim is free and has no subscription. I have some server costs, but everything is manageable right now. Enjoy.",
                },
              },
              {
                "@type": "Question",
                name: "Do I need the Chrome extension?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Only for initial ESPN setup. The Flaim Fantasy Connector securely syncs the ESPN access needed for your private leagues. Yahoo connects through an authorization flow, and Sleeper connects with your username.",
                },
              },
              {
                "@type": "Question",
                name: "Which AI apps work with Flaim?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Flaim Fantasy is fully available in ChatGPT's App Store. Setup is extremely easy. Flaim can also connect through Claude and Perplexity. See the AI Apps guide for current availability and setup instructions.",
                },
              },
              {
                "@type": "Question",
                name: "Can Flaim change anything in my leagues?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "No. Flaim cannot make trades, add or drop players, edit lineups, or change settings in ESPN, Yahoo, or Sleeper. A Refresh action may update Flaim's own list of your connected leagues, but it never changes the fantasy platform.",
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
              Fantasy platforms
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
        <div className="flex flex-row flex-wrap items-center justify-center gap-3">
          <SignedOut>
            <Button asChild size="lg">
              <Link href="/leagues">Connect Your Leagues</Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button asChild size="lg">
              <Link href="/leagues">Your Leagues</Link>
            </Button>
          </SignedIn>
          <Button asChild variant="outline" size="lg">
            <Link href="/guide">Setup Guide</Link>
          </Button>
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
              Ask your AI to grade the roster you actually drafted, identify
              your biggest strengths and weaknesses, compare your team with the
              rest of the league, and show you what to fix before Week 1.
            </p>
            <p className="mt-4 font-medium">
              No roster screenshots. No typing every player into a generic team
              grader. Flaim brings the league context with it.
            </p>
            <Button asChild className="mt-6">
              <Link href="/fantasy-football">
                See Fantasy Football Analysis
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

      {/* Prompt examples */}
      <section className="bg-muted px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-center text-2xl font-bold">
            Ask about your real league
          </h2>
          <p className="mx-auto mb-8 mt-2 max-w-2xl text-center text-muted-foreground">
            Flaim can bring the right league context into questions like these.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {HOMEPAGE_PROMPT_PLACEHOLDERS.map((prompt) => (
              <article
                key={prompt.question}
                data-copy-prompt-placeholder
                className="rounded-xl border bg-background p-4"
              >
                <p className="font-medium">&ldquo;{prompt.question}&rdquo;</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {prompt.tools.map((tool) => (
                    <span
                      key={tool}
                      className="inline-flex rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Trust badges */}
      <section className="bg-background px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
          <div className="rounded-xl border bg-background p-4">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Read-only where it matters
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
              All your leagues in one account
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
                Can ChatGPT access my fantasy league?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-2 px-4 pb-4 text-sm text-muted-foreground">
                <p>
                  Yes. First, create a Flaim account. Second, connect your
                  league to Flaim. Third, connect Flaim in your AI app. That&apos;s
                  it. Flaim bridges your AI app to your fantasy leagues and back
                  again.
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
                  No. Connect your fantasy platforms once, and Flaim supplies
                  the league data on demand.
                </p>
              </div>
            </details>

            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Is Flaim free?
                <ChevronDown className="ml-2 h-5 w-5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-2 px-4 pb-4 text-sm text-muted-foreground">
                <p>
                  Yes. Flaim is free and has no subscription. I have some server
                  costs, but everything is manageable right now. Enjoy.
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
                  Only for initial ESPN setup. The Flaim Fantasy Connector
                  securely syncs the ESPN access needed for your private
                  leagues. Yahoo connects through an authorization flow, and
                  Sleeper connects with your username.
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
                  Flaim Fantasy is fully available in ChatGPT&apos;s App Store.
                  Setup is extremely easy. Flaim can also connect through Claude
                  and Perplexity. See the{" "}
                  <Link href="/guide/ai" className="text-primary hover:underline">
                    AI Apps guide
                  </Link>{" "}
                  for current availability and setup instructions.
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
                  lineups, or change settings in ESPN, Yahoo, or Sleeper. A
                  Refresh action may update Flaim&apos;s own list of your connected
                  leagues, but it never changes the fantasy platform.
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
            <SignedOut>
              <Button asChild size="lg">
                <Link href="/leagues">Connect Your Leagues</Link>
              </Button>
            </SignedOut>
            <SignedIn>
              <Button asChild size="lg">
                <Link href="/leagues">Your Leagues</Link>
              </Button>
            </SignedIn>
            <Button asChild variant="outline" size="lg">
              <Link href="/guide">Read the Setup Guide</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Founder note */}
      <section id="about-flaim" className="scroll-mt-24 px-4 py-12">
        <div className="container mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold mb-2">
            Built for my league. Shared with yours.
          </h2>
          <p className="text-muted-foreground">
            I&apos;m Gerry and I built Flaim because I felt like giving back.
            Flaim is open source and maintained for the long-term.
          </p>
          <p className="mt-4 text-sm">
            <a
              href="https://github.com/jdguggs10/flaim"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              About Flaim
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
