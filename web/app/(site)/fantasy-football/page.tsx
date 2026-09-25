import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";

import {
  FootballConnectionButtons,
  FootballSeasonalPage,
} from "@/components/site/football-seasonal-variants";

export const metadata: Metadata = {
  title: "Fantasy Football in ChatGPT and Claude",
  description:
    "Connect your ESPN, Yahoo, or Sleeper fantasy football league to ChatGPT or Claude with Flaim Fantasy. Grade your real roster, find waiver options, evaluate trades, compare matchups, and get start/sit help without uploading screenshots.",
  alternates: {
    canonical: "https://flaim.app/fantasy-football",
  },
  openGraph: {
    title: "Fantasy Football in ChatGPT and Claude",
    description:
      "Ask ChatGPT or Claude about your real fantasy football roster, waivers, trades, and matchups, without screenshots.",
    url: "https://flaim.app/fantasy-football",
  },
};

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

const FOOTBALL_FAQS: readonly {
  question: string;
  answer: string;
  link?: { href: string; label: string };
}[] = [
  {
    question: "Is there a ChatGPT app for fantasy football?",
    answer:
      "Yes. Flaim Fantasy works inside ChatGPT and Claude. Connect your ESPN, Yahoo, or Sleeper league once, then ask about your actual team, from start or sit calls to waiver pickups and trades. It's free.",
  },
  {
    question: "How do I connect my ESPN league to ChatGPT?",
    answer:
      "Sync ESPN once with the free Flaim Chrome extension on a computer, then add Flaim Fantasy to ChatGPT. The ESPN docs walk through each step.",
    link: { href: "/docs/espn", label: "ESPN docs" },
  },
  {
    question: "Do Yahoo and Sleeper need the extension?",
    answer:
      "No. Yahoo connects with Yahoo sign-in, and Sleeper just needs your username. Only ESPN needs the Chrome extension, and only once.",
  },
  {
    question: "Can Flaim set my lineup or make trades?",
    answer:
      "No. Flaim is read-only. It can't set lineups, add or drop players, or make trades.",
  },
];

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

      <FootballSeasonalPage />

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
              href="/docs"
              className="inline-flex items-center text-sm font-medium text-primary hover:underline"
            >
              Flaim Docs
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

      <section className="px-4 pb-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight">FAQs</h2>
          <div className="mt-6 space-y-3">
            {FOOTBALL_FAQS.map((faq) => (
              <details
                key={faq.question}
                className="group rounded-xl border bg-background"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 p-4 font-medium">
                  {faq.question}
                  <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-muted-foreground">
                  {faq.answer}
                  {faq.link ? (
                    <>
                      {" "}
                      <Link
                        href={faq.link.href}
                        className="font-medium text-primary hover:underline"
                      >
                        {faq.link.label}
                      </Link>
                    </>
                  ) : null}
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
