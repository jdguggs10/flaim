import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const metadata: Metadata = {
  title: "Flaim Setup Guide",
  description:
    "Use Flaim in three steps: connect fantasy platforms, review leagues and sports coverage, then use Flaim Fantasy from ChatGPT or another AI agent.",
  alternates: {
    canonical: "https://flaim.app/guide",
  },
};

const setupSteps = [
  {
    number: "1",
    title: "Platforms",
    body: "Connect ESPN, Yahoo, and/or Sleeper to allow Flaim to access your fantasy league data.",
    primaryHref: "/leagues#platforms",
    primaryLabel: "Connect Your Leagues",
    secondaryHref: "/guide/platforms",
    secondaryLabel: "Fantasy sports provider help",
  },
  {
    number: "2",
    title: "Leagues & Sports",
    body: "Confirm the leagues and seasons Flaim discovered. Then, optionally set your default sport and default league per sport.",
    primaryHref: "/leagues#leagues",
    primaryLabel: "Manage your leagues",
    secondaryHref: "/guide/sports",
    secondaryLabel: "Sports coverage and tools help",
  },
  {
    number: "3",
    title: "AI Agents",
    body: "Flaim Fantasy is an official ChatGPT App. Other AI's including Claude, Perplexity, and more can connect unofficially as well.",
    primaryHref: "/leagues#connect-ai",
    primaryLabel: "Connect AI agents",
    secondaryHref: "/guide/ai#custom-connectors",
    secondaryLabel: "Plugins, connectors, and AI help",
  },
] as const;

const guideLinks = [
  {
    href: "/guide/platforms",
    title: "Fantasy sports provider help",
    body: "ESPN, Yahoo, and Sleeper setup details and troubleshooting.",
  },
  {
    href: "/guide/sports",
    title: "Sports coverage and tools help",
    body: "Supported sports, available tools, and what Flaim can analyze.",
  },
  {
    href: "/guide/ai",
    title: "Plugins, connectors, and AI help",
    body: "ChatGPT setup plus unofficial custom connector notes.",
  },
] as const;

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <div className="mb-10 space-y-4">
          <h1 className="text-3xl font-bold">Flaim Setup Guide</h1>
        </div>

        <section className="relative mb-4 rounded-lg border bg-muted/40 p-5 pr-14">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="absolute right-5 top-5 rounded-md border border-muted bg-muted/60 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Account security info"
                title="Account security info"
              >
                <ShieldCheck className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-w-xs text-sm text-muted-foreground">
              Your Flaim account stores your connected platform status,
              discovered leagues, and defaults. Platform credentials are
              encrypted, and Flaim is read-only by design.
            </PopoverContent>
          </Popover>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-background font-bold text-muted-foreground">
                0
              </div>
              <div>
                <h2 className="text-lg font-semibold">Create a Flaim Account</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Flaim needs an account before it can securely remember your
                  connected platforms, discovered leagues, and default choices.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="shrink-0 sm:w-44">
              <Link href="/leagues">
                Start setup
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-4">
          {setupSteps.map((step) => (
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
                <div className="flex shrink-0 flex-col gap-2 sm:w-44">
                  <Button asChild className="w-full">
                    <Link href={step.primaryHref}>
                      {step.primaryLabel}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full">
                    <Link href={step.secondaryHref}>{step.secondaryLabel}</Link>
                  </Button>
                </div>
              </div>
            </Card>
          ))}
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
