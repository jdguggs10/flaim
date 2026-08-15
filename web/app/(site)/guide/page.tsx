import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Using Flaim",
  description:
    "Create your Flaim account, connect ESPN, Yahoo, or Sleeper leagues, then connect Flaim to ChatGPT or Claude, with Perplexity as an optional custom connector.",
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
    secondaryHref: "/guide/flaim",
    secondaryLabel: "Flaim help",
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
          <h2 className="text-lg font-semibold">After setup</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Use Your Leagues anytime you want to add another league, sync a new
            season, choose defaults, or disconnect a platform. You can also
            check which sports and leagues Flaim supports, or see fantasy
            football examples using a real league.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button asChild variant="outline">
              <Link href="/leagues#leagues">Manage Your Leagues</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/guide/sports">
                Sports and league coverage
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/fantasy-football">
                Fantasy football examples
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
