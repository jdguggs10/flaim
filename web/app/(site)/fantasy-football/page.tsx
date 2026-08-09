import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";

import { FootballMediaShowcase } from "@/components/site/football-media-showcase";
import { Button } from "@/components/ui/button";
import {
  CHATGPT_APP_URL,
  CLAUDE_CONNECTOR_DIRECTORY_URL,
} from "@/lib/product-links";

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

const FOOTBALL_PROOF = [
  {
    title: "Grade the team you drafted",
    body: "Use your real roster, scoring rules, league size, and positional depth instead of a generic player list.",
  },
  {
    title: "Work your actual waiver wire",
    body: "Compare what your roster needs with players who are really available in your league.",
  },
  {
    title: "Follow the season",
    body: "Bring matchups, standings, transactions, and league history into the same conversation.",
  },
] as const;

const CONNECTION_STEPS = [
  {
    title: "Create your Flaim account",
    body: "Free, with no Flaim subscription.",
  },
  {
    title: "Connect your football leagues",
    body: "ESPN, Yahoo, or Sleeper.",
  },
  {
    title: "Add Flaim to your AI",
    body: "Open Flaim in ChatGPT or Claude and start asking.",
  },
] as const;

const PRODUCT_BOUNDARIES = [
  {
    title: "Free",
    body: "No Flaim subscription.",
  },
  {
    title: "Read-only",
    body: "No trades, drops, lineup edits, or league changes.",
  },
  {
    title: "Multiple leagues",
    body: "Keep every football league in one Flaim account.",
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
      "Flaim supports fantasy football leagues on ESPN, Yahoo, and Sleeper. Current connection information is available on the fantasy platforms page.",
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

function FootballConnectionButtons() {
  return (
    <div className="grid w-full max-w-lg grid-cols-2 gap-3">
      <Button asChild size="lg" className="col-span-2 w-full">
        <Link href="/leagues">Connect Your League First</Link>
      </Button>
      <Button asChild size="lg" variant="outline" className="w-full">
        <a href={CHATGPT_APP_URL} target="_blank" rel="noopener noreferrer">
          Add to ChatGPT
        </a>
      </Button>
      <Button asChild size="lg" variant="outline" className="w-full">
        <a
          href={CLAUDE_CONNECTOR_DIRECTORY_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Add to Claude
        </a>
      </Button>
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

      <section className="border-b px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Your real fantasy football league
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Grade your real fantasy football team with AI
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Connect ESPN, Yahoo, or Sleeper, then ask ChatGPT or Claude about
              the roster you actually drafted, with your league context already
              included.
            </p>
            <p className="mt-4 font-medium">
              No roster screenshots. No manual player entry.
            </p>
            <div className="mt-7">
              <FootballConnectionButtons />
            </div>
          </div>

          <div id="showcase" className="scroll-mt-24">
            <FootballMediaShowcase />
          </div>
        </div>
      </section>

      <section className="border-b bg-muted/50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-4 md:grid-cols-3">
            {FOOTBALL_PROOF.map((item) => (
              <article key={item.title} className="rounded-2xl border bg-background p-5">
                <h2 className="text-lg font-semibold">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Three quick steps
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight">
                Connect once. Ask all season.
              </h2>
            </div>
            <Link
              href="/guide"
              className="inline-flex items-center text-sm font-medium text-primary hover:underline"
            >
              Using Flaim
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-7 grid gap-4 md:grid-cols-3">
            {CONNECTION_STEPS.map((step, index) => (
              <article key={step.title} className="rounded-2xl border p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {index + 1}
                </div>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-3 sm:grid-cols-3">
          {PRODUCT_BOUNDARIES.map((item) => (
            <div key={item.title} className="rounded-xl border bg-background p-4">
              <p className="font-semibold">{item.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Fantasy football FAQs
          </h2>
          <div className="mt-7 space-y-3">
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

      <section className="border-t bg-muted/50 px-4 py-14 text-center sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Ask about the team you actually drafted
          </h2>
          <p className="mt-3 leading-7 text-muted-foreground">
            Connect your football league, add Flaim to your AI, and start asking.
          </p>
          <div className="mx-auto mt-7 max-w-lg">
            <FootballConnectionButtons />
          </div>
          <Link
            href="/#live-demo"
            className="mt-6 inline-flex items-center text-sm font-medium text-primary hover:underline"
          >
            Explore the live demo
            <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
