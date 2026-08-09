import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Fantasy Football in AI: Analyze Your Real Team",
  description:
    "Connect your ESPN, Yahoo, or Sleeper fantasy football league to AI. Grade your real roster, find waiver options, evaluate trades, compare matchups, and get start/sit help without uploading screenshots.",
  alternates: {
    canonical: "https://flaim.app/fantasy-football",
  },
  openGraph: {
    title: "Fantasy Football in AI: Analyze Your Real Team",
    description:
      "Grade your connected roster, evaluate waivers and trades, and analyze real matchups without screenshots.",
    url: "https://flaim.app/fantasy-football",
  },
};

const DRAFT_PROMPTS = [
  "What grade would you give my draft, and why?",
  "What is the biggest weakness in my roster construction?",
  "Where am I strongest compared with the rest of my league?",
  "Which position should I improve before Week 1?",
  "Do I have the best team in the league?",
  "Who should I target in a trade based on what my roster needs?",
] as const;

const CONTEXT_ITEMS = [
  {
    title: "Your players",
    body: "See starters, bench depth, player information, and the shape of your roster.",
  },
  {
    title: "Your league",
    body: "Account for scoring rules, roster settings, team count, standings, and league structure.",
  },
  {
    title: "Your alternatives",
    body: "Compare your roster with players who are actually available in your league.",
  },
  {
    title: "Your competition",
    body: "Evaluate your matchup and compare your team with the rest of the league.",
  },
] as const;

const SEASON_ITEMS = [
  {
    title: "Waiver wire",
    body: "Ask who to add and drop based on your roster and the players available in your league.",
  },
  {
    title: "Start and sit",
    body: "Use your current lineup, matchup, and scoring format—and current player research when your AI app provides it—to think through weekly decisions.",
  },
  {
    title: "Trades",
    body: "Evaluate a trade against the strengths and weaknesses of your actual team—not an imaginary roster.",
  },
  {
    title: "Matchups and standings",
    body: "See who is winning, what the matchup means, and how your team compares with the league.",
  },
] as const;

const HOW_IT_WORKS = [
  {
    title: "Create your Flaim account",
    body: "Create your free account so Flaim can securely remember the leagues you connect.",
  },
  {
    title: "Connect your fantasy leagues",
    body: "Connect the ESPN, Yahoo, or Sleeper fantasy football leagues you already play in.",
  },
  {
    title: "Connect your AI app",
    body: "Open Flaim in ChatGPT, Claude, or Perplexity, authorize your account, and start asking about your team.",
  },
] as const;

const PRODUCT_BOUNDARIES = [
  {
    title: "Free",
    body: "Flaim has no subscription. You bring your own AI app.",
  },
  {
    title: "Read-only",
    body: "Flaim cannot make trades, add or drop players, edit your lineup, or change league settings.",
  },
  {
    title: "Multiple leagues",
    body: "Connect more than one football league and tell your AI which one you want to discuss.",
  },
] as const;

const FOOTBALL_FAQS = [
  {
    question: "Can AI grade the fantasy football team I actually drafted?",
    answer:
      "Yes. Once your league is connected through Flaim, your AI can inspect your real roster and league context before giving you a grade, explaining your strengths, or identifying weaknesses.",
  },
  {
    question: "Do I have to upload a screenshot of my roster?",
    answer:
      "No. Flaim supplies your connected roster and league data directly when your AI asks for it.",
  },
  {
    question: "Which fantasy football platforms work with Flaim?",
    answer:
      "Flaim supports fantasy football leagues on ESPN, Yahoo, and Sleeper. Current connection availability and setup instructions are listed in the Platforms guide.",
  },
  {
    question: "Can Flaim set my lineup or make a trade for me?",
    answer:
      "No. Flaim is for analysis and advice. It cannot change your lineup, make trades, add or drop players, or modify your league.",
  },
  {
    question: "Can I use Flaim after draft season?",
    answer:
      "Yes. Use the same connection throughout the season for waiver, start/sit, trade, matchup, standings, transaction, and league-history questions.",
  },
] as const;

function DevelopmentScreenshotSlot({
  title,
  caption,
}: {
  title: string;
  caption: string;
}) {
  if (process.env.NODE_ENV !== "development") return null;

  return (
    <div className="flex min-h-72 items-center justify-center rounded-3xl border border-dashed bg-muted/40 p-8 text-center">
      <div className="max-w-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground/65">
          {title}
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          An approved, sanitized mobile screenshot will appear here after the
          capture pass.
        </p>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">{caption}</p>
      </div>
    </div>
  );
}
export default function FantasyFootballPage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FOOTBALL_FAQS.map((faq) => ({
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: {
                "@type": "Answer",
                text: faq.answer,
              },
            })),
          }),
        }}
      />

      <section className="border-b px-4 py-16 sm:px-6 md:py-24 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Your real fantasy football league
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Grade your real fantasy football team with AI
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">
            Connect your ESPN, Yahoo, or Sleeper league to Flaim, then ask
            ChatGPT, Claude, or Perplexity to analyze the roster you actually
            drafted—with your league settings, opponents, standings, and
            available players included.
          </p>
          <p className="mt-5 max-w-3xl font-medium leading-7">
            No screenshots. No copy-pasting every player. No generic team grade
            built without your league context.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/leagues">Connect Your Football League</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#draft-analysis">See a Real Example</Link>
            </Button>
          </div>
        </div>
      </section>

      <section
        id="draft-analysis"
        className="scroll-mt-24 px-4 py-14 sm:px-6 lg:px-8"
      >
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              After your draft
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              Your draft grade should know your league
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              A useful team grade depends on more than player names. League
              size, scoring rules, roster settings, positional depth,
              opponents, and the waiver wire all change what a good roster
              looks like. Flaim gives your AI that context.
            </p>
            <p className="mt-6 font-semibold">Try asking:</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
              {DRAFT_PROMPTS.map((prompt) => (
                <li key={prompt} className="flex gap-3">
                  <span aria-hidden="true" className="text-primary">
                    •
                  </span>
                  <span>{prompt}</span>
                </li>
              ))}
            </ul>
          </div>

          <DevelopmentScreenshotSlot
            title="Post-draft roster grade"
            caption="A real connected roster—not a manually entered list of players."
          />
        </div>
      </section>

      <section className="border-y bg-muted/50 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Your roster is only part of the story
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
            A screenshot may show your starters and bench. It usually does not
            show your scoring settings, league size, opponents, available free
            agents, recent transactions, past seasons, or where every team
            stands. Flaim can supply that missing context directly from your
            connected league.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CONTEXT_ITEMS.map((item) => (
              <div key={item.title} className="rounded-2xl border bg-background p-5">
                <h3 className="font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold tracking-tight">
            From draft night through the championship
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
            The same connection keeps working after your draft. Ask new
            questions as matchups, injuries, waivers, trades, and standings
            change.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {SEASON_ITEMS.map((item) => (
              <div key={item.title} className="rounded-2xl border p-5">
                <h3 className="font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.body}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <DevelopmentScreenshotSlot
              title="Waiver or roster-construction decision"
              caption="Advice grounded in your roster and your league's available players."
            />
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/50 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Get connected in three steps
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {HOW_IT_WORKS.map((step, index) => (
              <div key={step.title} className="rounded-2xl border bg-background p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {index + 1}
                </div>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
          <Button asChild className="mt-8">
            <Link href="/leagues">Create Your Flaim Account</Link>
          </Button>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Clear product boundaries
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PRODUCT_BOUNDARIES.map((item) => (
              <div key={item.title} className="rounded-2xl border p-5">
                <h3 className="font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/50 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Fantasy football FAQs
          </h2>
          <div className="mt-8 space-y-3">
            {FOOTBALL_FAQS.map((faq) => (
              <details key={faq.question} className="group rounded-xl border bg-background">
                <summary className="flex cursor-pointer items-center justify-between gap-4 p-4 font-medium">
                  {faq.question}
                  <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-muted-foreground">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 text-center sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Ask about the team you actually drafted
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Connect your fantasy football league and give your AI the context it
            has been missing.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/leagues">Connect Your Football League</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/#live-demo">
                Explore the Live Demo
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Prefer setup instructions? Read the{" "}
            <Link href="/guide/ai" className="text-primary hover:underline">
              AI Apps guide
            </Link>{" "}
            or the{" "}
            <Link href="/guide/platforms" className="text-primary hover:underline">
              Platforms guide
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
