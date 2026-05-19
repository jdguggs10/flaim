import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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
    body: "Connect ESPN, Yahoo, or Sleeper so Flaim can read the fantasy accounts that actually hold your leagues.",
    primaryHref: "/leagues#platforms",
    primaryLabel: "Open Your Leagues",
    secondaryHref: "/guide/platforms",
    secondaryLabel: "Platform help",
  },
  {
    number: "2",
    title: "Leagues & Sports",
    body: "Confirm the leagues Flaim discovered, set your default sport or league when needed, and understand what each sport supports.",
    primaryHref: "/leagues#leagues",
    primaryLabel: "Manage leagues",
    secondaryHref: "/guide/sports",
    secondaryLabel: "Sports coverage",
  },
  {
    number: "3",
    title: "AI Agents",
    body: "Use Flaim Fantasy in ChatGPT first. Other AI agents can connect unofficially when they support custom MCP connectors.",
    primaryHref: "/guide/ai#chatgpt",
    primaryLabel: "ChatGPT setup",
    secondaryHref: "/guide/ai#custom-connectors",
    secondaryLabel: "Custom connectors",
  },
] as const;

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <div className="mb-10 space-y-4">
          <h1 className="text-3xl font-bold">Flaim Setup Guide</h1>
          <p className="text-lg font-medium text-foreground">
            Three decisions, one setup page.
          </p>
          <p className="text-muted-foreground">
            Use this guide to understand the flow. Use Your Leagues when
            you&apos;re ready to connect platforms, manage league defaults, and
            prepare Flaim for ChatGPT or another AI agent.
          </p>
        </div>

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
          <h2 className="text-lg font-semibold">Where setup actually happens</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your Leagues is the source of truth for connecting platforms,
            reviewing discovered leagues, and setting defaults. The guide pages
            are here for context, troubleshooting, and coverage details.
          </p>
        </section>
      </div>
    </div>
  );
}
