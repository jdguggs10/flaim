import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  DEFAULT_FOOTBALL_CONTRAST_VARIANT,
  DEFAULT_FOOTBALL_VARIANT,
  FootballConnectionButtons,
  FootballSeasonalVariant,
  FootballVariantSwitcher,
  isFootballContrastVariant,
  isFootballVariant,
} from "@/components/site/football-seasonal-variants";

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

interface FantasyFootballPageProps {
  searchParams?: Promise<{
    contrast?: string | string[];
    variant?: string | string[];
  }>;
}

export default async function FantasyFootballPage({
  searchParams,
}: FantasyFootballPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedVariant = Array.isArray(resolvedSearchParams?.variant)
    ? resolvedSearchParams.variant[0]
    : resolvedSearchParams?.variant;
  const requestedContrastVariant = Array.isArray(
    resolvedSearchParams?.contrast,
  )
    ? resolvedSearchParams.contrast[0]
    : resolvedSearchParams?.contrast;
  const showVariantLab = process.env.VERCEL_ENV !== "production";
  const activeVariant =
    showVariantLab && requestedVariant && isFootballVariant(requestedVariant)
      ? requestedVariant
      : DEFAULT_FOOTBALL_VARIANT;
  const activeContrastVariant =
    showVariantLab &&
    requestedContrastVariant &&
    isFootballContrastVariant(requestedContrastVariant)
      ? requestedContrastVariant
      : DEFAULT_FOOTBALL_CONTRAST_VARIANT;

  return (
    <div className="min-h-screen bg-background">
      {showVariantLab ? (
        <FootballVariantSwitcher activeVariant={activeVariant} />
      ) : null}

      <FootballSeasonalVariant
        variant={activeVariant}
        contrastVariant={activeContrastVariant}
        showContrastVariantLab={
          showVariantLab && activeVariant === "season-chapters"
        }
      />

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
