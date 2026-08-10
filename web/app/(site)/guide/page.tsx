import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Using Flaim",
  description:
    "Create your Flaim account, connect ESPN, Yahoo, or Sleeper leagues, then connect Flaim to ChatGPT or an optional Claude or Perplexity custom connector.",
  alternates: {
    canonical: "https://flaim.app/guide",
  },
};

interface GuideStep {
  number: string;
  title: string;
  body: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

const guideSteps: readonly GuideStep[] = [
  {
    number: "1",
    title: "Create your Flaim account",
    body: "Create your free account so Flaim can securely remember the fantasy platforms and leagues you connect.",
    primaryHref: "/leagues",
    primaryLabel: "Create Your Account",
  },
  {
    number: "2",
    title: "Connect your fantasy leagues",
    body: "Connect ESPN, Yahoo, or Sleeper. Flaim will discover the leagues available through that platform.",
    primaryHref: "/leagues#platforms",
    primaryLabel: "Connect Your Leagues",
    secondaryHref: "/guide/platforms",
    secondaryLabel: "Platform help",
  },
  {
    number: "3",
    title: "Connect your AI app",
    body: "Open Flaim Fantasy in ChatGPT or Claude, or use an optional custom connector in Perplexity, then authorize your account.",
    primaryHref: "/leagues#connect-ai",
    primaryLabel: "Connect Your AI",
    secondaryHref: "/guide/ai",
    secondaryLabel: "AI app help",
  },
];

const guideLinks = [
  {
    href: "/guide/platforms",
    title: "Fantasy sports provider help",
    body: "ESPN, Yahoo, and Sleeper connection details and troubleshooting.",
  },
  {
    href: "/guide/sports",
    title: "Sports and league coverage",
    body: "Supported sports and the roster, matchup, and league info Flaim can use.",
  },
  {
    href: "/guide/ai",
    title: "Using Flaim in your AI app",
    body: "Open Flaim in ChatGPT or Claude, plus optional Perplexity custom-connector guidance.",
  },
  {
    href: "/fantasy-football",
    title: "Fantasy football analysis",
    body: "Draft grades, roster analysis, waivers, trades, matchups, and start/sit decisions using your real league.",
  },
] as const;

const stepButtonClass =
  "h-auto min-h-10 w-full whitespace-normal px-3 py-2 text-center leading-snug";

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <div className="mb-10 space-y-4">
          <h1 className="text-3xl font-bold">Using Flaim</h1>
          <p className="max-w-2xl leading-7 text-muted-foreground">
            Create your account, connect your fantasy leagues, then connect the
            AI app you already use. That&apos;s it.
          </p>
        </div>

        <section className="grid gap-4">
          {guideSteps.map((step) => (
            <Card key={step.number} className="p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">
                    {step.number}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">{step.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {step.body}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:w-56">
                  <Button asChild className={stepButtonClass}>
                    <Link href={step.primaryHref}>
                      {step.primaryLabel}
                    </Link>
                  </Button>
                  {step.secondaryHref && step.secondaryLabel ? (
                    <Button asChild variant="outline" className={stepButtonClass}>
                      <Link href={step.secondaryHref}>{step.secondaryLabel}</Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </section>

        <div className="mt-4 flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p>
            Flaim is read-only. Your account stores your connected platform
            status and discovered leagues, but Flaim cannot make trades, edit
            lineups, or change your league.
          </p>
        </div>

        <section className="mt-8 rounded-lg border bg-background p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Afterward: manage your leagues</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your Leagues is where you add another league, sync new seasons,
            choose optional defaults, or disconnect a platform. None of that is
            required to finish the three steps above.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="outline">
              <Link href="/leagues#leagues">Manage Your Leagues</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/guide/sports">
                Sports and league coverage
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>

        <section className="mt-10 rounded-lg border bg-muted/40 p-5">
          <h2 className="text-lg font-semibold">Additional Information</h2>
          <div className="mt-4 grid gap-3">
            {guideLinks.map((guide) => (
              <Link
                key={guide.href}
                href={guide.href}
                className="group rounded-lg border bg-background p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <h3 className="flex-1 text-sm font-semibold">{guide.title}</h3>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {guide.body}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
