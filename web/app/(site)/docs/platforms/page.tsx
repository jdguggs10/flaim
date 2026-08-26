import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GuideStepNavigation } from "@/components/site/guide-step-navigation";
import { CHROME_EXTENSION_URL } from "@/config/constants";

export const metadata: Metadata = {
  title: "Connect ESPN, Yahoo & Sleeper to Flaim",
  description:
    "Connect ESPN, Yahoo, or Sleeper fantasy leagues to Flaim. Use the ESPN Chrome extension, Yahoo sign-in, or your Sleeper username.",
  alternates: {
    canonical: "https://flaim.app/docs/platforms",
  },
};

const CONNECTION_FAQS = [
  {
    question: "My leagues do not appear",
    answer:
      "Make sure you connected the account that belongs to those leagues. For ESPN, open the Flaim Chrome extension and choose Sync or Re-sync. This refreshes your connected leagues and looks for the past seasons ESPN makes available. Then confirm the league appears in Your Leagues.",
  },
  {
    question: "Do I need the Chrome extension?",
    answer:
      "Only for ESPN. Yahoo connects through a secure sign-in, and Sleeper connects with your username. If you are setting up ESPN from a phone, Flaim can email you the extension link for later.",
  },
  {
    question: "Can Flaim change anything in my leagues?",
    answer:
      "No. Flaim cannot make trades, add or drop players, edit lineups, or change settings in ESPN, Yahoo, or Sleeper.",
  },
] as const;

const HOW_TO_SCHEMAS = [
  {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Connect ESPN fantasy leagues to Flaim",
    dateModified: "2026-08-26",
    description:
      "Use the Flaim Chrome extension to connect and sync ESPN fantasy leagues.",
    step: [
      "Open the Flaim ESPN Fantasy Connector in Chrome.",
      "Use the same Chrome profile that is signed in to Flaim and fantasy.espn.com.",
      "Choose Sync in the extension and confirm your ESPN leagues appear in Flaim.",
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Connect Yahoo fantasy leagues to Flaim",
    dateModified: "2026-08-15",
    description:
      "Connect Yahoo from Your Leagues, approve access, and sync your leagues.",
    step: [
      "Open Your Leagues in Flaim and choose Yahoo.",
      "Sign in to Yahoo and approve Flaim access.",
      "Return to Flaim and confirm your Yahoo leagues appear.",
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Connect Sleeper fantasy leagues to Flaim",
    dateModified: "2026-08-15",
    description:
      "Enter your Sleeper username in Your Leagues and connect your football or basketball leagues.",
    step: [
      "Open Your Leagues in Flaim and choose Sleeper.",
      "Enter your exact Sleeper username and choose Connect.",
      "Confirm your Sleeper football or basketball leagues appear in Flaim.",
    ],
  },
].map((howTo) => ({
  ...howTo,
  step: howTo.step.map((text, index) => ({
    "@type": "HowToStep",
    position: index + 1,
    text,
  })),
}));

export default function PlatformsGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            ...HOW_TO_SCHEMAS,
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: CONNECTION_FAQS.map((faq) => ({
                "@type": "Question",
                name: faq.question,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: faq.answer,
                },
              })),
            },
          ]),
        }}
      />

      <section className="border-b px-4 py-16 sm:px-6 md:py-20 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Step 2 of 3
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl">
            Connect your fantasy leagues
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">
            Open Your Leagues and connect ESPN, Yahoo, or Sleeper. When your
            leagues appear in Flaim, you are ready to add your AI.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/leagues#platforms">Open Your Leagues</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/docs/ai">AI App Docs</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Choose your platform
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            ESPN, Yahoo, and Sleeper
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
            Each platform connects a little differently. You only need the
            account you already use for fantasy sports.
          </p>

          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            <article className="flex flex-col rounded-2xl border p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Chrome extension
              </p>
              <h3 className="mt-3 text-2xl font-semibold">ESPN</h3>
              <p className="mt-3 leading-7 text-muted-foreground">
                Open the Flaim extension from the Chrome profile that is signed
                in to both Flaim and ESPN Fantasy. Then choose Sync.
              </p>
              <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
                Football, baseball, basketball, and hockey.
              </p>
              <Button asChild className="mt-6 w-full">
                <a
                  href={CHROME_EXTENSION_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open ESPN Extension
                  <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
                </a>
              </Button>
              <details className="group mt-4 rounded-xl bg-muted/60">
                <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 text-sm font-medium">
                  Good to know
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-muted-foreground">
                  Phone browsers cannot run the extension. Open ESPN in Your
                  Leagues and choose Email me the setup link, then finish on a
                  computer. Return to the extension whenever you need to sync a
                  different ESPN account or update your leagues.
                </p>
              </details>
            </article>

            <article className="flex flex-col rounded-2xl border p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Secure sign-in
              </p>
              <h3 className="mt-3 text-2xl font-semibold">Yahoo</h3>
              <p className="mt-3 leading-7 text-muted-foreground">
                Open Yahoo in Your Leagues, sign in, and approve Flaim access.
                Your leagues appear after the connection finishes syncing.
              </p>
              <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
                Football, baseball, basketball, and hockey.
              </p>
              <Button asChild className="mt-6 w-full">
                <Link href="/leagues#platforms">Connect Yahoo in Flaim</Link>
              </Button>
              <details className="group mt-4 rounded-xl bg-muted/60">
                <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 text-sm font-medium">
                  Good to know
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-muted-foreground">
                  Once connected, Sync leagues checks for your latest leagues.
                  Reconnect Yahoo opens Yahoo sign-in again if the connection
                  stops working.
                </p>
              </details>
            </article>

            <article className="flex flex-col rounded-2xl border p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Username only
              </p>
              <h3 className="mt-3 text-2xl font-semibold">Sleeper</h3>
              <p className="mt-3 leading-7 text-muted-foreground">
                Open Sleeper in Your Leagues, enter your exact Sleeper
                username, and choose Connect. No extension or Sleeper password
                is needed.
              </p>
              <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
                Football and basketball.
              </p>
              <Button asChild className="mt-6 w-full">
                <Link href="/leagues#platforms">Connect Sleeper in Flaim</Link>
              </Button>
              <details className="group mt-4 rounded-xl bg-muted/60">
                <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 text-sm font-medium">
                  Good to know
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-muted-foreground">
                  Use your Sleeper username, not your display name. After
                  connecting, choose Refresh whenever you want Flaim to check
                  for your latest leagues.
                </p>
              </details>
            </article>
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Check your connection
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Your Leagues should show the platform, league name, team, and
            current season. Once the league you want appears, Flaim can share
            it with your AI.
          </p>

          <h2 className="mt-12 text-2xl font-bold tracking-tight">
            Connection FAQs
          </h2>
          <div className="mt-6 space-y-3">
            {CONNECTION_FAQS.map((faq) => (
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
                </p>
              </details>
            ))}
          </div>

          <GuideStepNavigation
            backHref="/docs/flaim"
            backLabel="Back to Account Docs"
            nextHref="/docs/ai"
            nextLabel="Continue to AI App Docs"
          />
        </div>
      </section>
    </div>
  );
}
