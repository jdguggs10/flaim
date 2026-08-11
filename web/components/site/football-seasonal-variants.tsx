import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CirclePlay,
  Film,
  MessageCircleQuestion,
  Search,
  Sparkles,
  Trophy,
} from "lucide-react";

import { FootballMediaShowcase } from "@/components/site/football-media-showcase";
import { Button } from "@/components/ui/button";
import {
  CHATGPT_APP_URL,
  CLAUDE_CONNECTOR_DIRECTORY_URL,
} from "@/lib/product-links";

export const FOOTBALL_VARIANTS = [
  {
    id: "game-film",
    label: "Game Film",
    description: "Media wall",
  },
  {
    id: "inside-answer",
    label: "Inside the Answer",
    description: "Question to answer",
  },
  {
    id: "season-story",
    label: "Season Story",
    description: "Draft to playoffs",
  },
] as const;

export type FootballVariantId = (typeof FOOTBALL_VARIANTS)[number]["id"];

export const DEFAULT_FOOTBALL_VARIANT: FootballVariantId = "inside-answer";

export function isFootballVariant(value: string): value is FootballVariantId {
  return FOOTBALL_VARIANTS.some((variant) => variant.id === value);
}

export function FootballVariantSwitcher({
  activeVariant,
}: {
  activeVariant: FootballVariantId;
}) {
  return (
    <aside className="border-b bg-muted/60 px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Seasonal page lab
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Three staging-only directions. Choose one to compare the full page.
          </p>
        </div>
        <nav
          className="grid gap-2 sm:grid-cols-3"
          aria-label="Choose a fantasy football page variant"
        >
          {FOOTBALL_VARIANTS.map((variant) => {
            const isActive = variant.id === activeVariant;

            return (
              <Link
                key={variant.id}
                href={`/fantasy-football?variant=${variant.id}`}
                scroll={false}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-xl border px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:border-foreground/25"
                }`}
              >
                <span className="block text-sm font-semibold">
                  {variant.label}
                </span>
                <span
                  className={`mt-0.5 block text-xs ${
                    isActive
                      ? "text-primary-foreground/75"
                      : "text-muted-foreground"
                  }`}
                >
                  {variant.description}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

export function FootballConnectionButtons({
  primaryLabel = "Connect Your League First",
}: {
  primaryLabel?: string;
}) {
  return (
    <div className="grid w-full max-w-lg grid-cols-2 gap-3">
      <Button asChild size="lg" className="col-span-2 w-full">
        <Link href="/leagues">{primaryLabel}</Link>
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

function FutureClip({
  label,
  title,
  description,
  compact = false,
}: {
  label: string;
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative flex overflow-hidden rounded-[1.75rem] border bg-gradient-to-br from-primary/10 via-background to-muted p-5 ${
        compact ? "min-h-64" : "min-h-80"
      }`}
    >
      <div className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full border bg-background/80 shadow-sm backdrop-blur">
        <CirclePlay className="h-5 w-5 text-primary" aria-hidden="true" />
      </div>
      <div className="mt-auto max-w-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          {label}
        </p>
        <p className="mt-2 text-lg font-semibold">{title}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function ImageProof({
  src,
  alt,
  label,
  title,
  description,
  aspectClassName,
  imageClassName = "object-contain",
  priority = false,
}: {
  src: string;
  alt: string;
  label: string;
  title: string;
  description: string;
  aspectClassName: string;
  imageClassName?: string;
  priority?: boolean;
}) {
  return (
    <figure className="overflow-hidden rounded-[1.75rem] border bg-card shadow-sm">
      <div className={`relative bg-muted/60 ${aspectClassName}`}>
        <Image
          src={src}
          alt={alt}
          fill
          priority={priority}
          sizes="(min-width: 1024px) 48vw, (min-width: 640px) 80vw, 94vw"
          className={imageClassName}
        />
      </div>
      <figcaption className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          {label}
        </p>
        <p className="mt-2 font-semibold">{title}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </figcaption>
    </figure>
  );
}

const FILM_SCENES = [
  {
    label: "Draft grade",
    title: "Grade the team I actually drafted",
    description:
      "Show the roster grade, position strengths, and the biggest weakness in one short phone clip.",
  },
  {
    label: "Waiver wire",
    title: "Find someone I can really add",
    description:
      "Show Flaim comparing roster needs with players who are still available in that league.",
  },
  {
    label: "Weekly matchup",
    title: "Tell me where this matchup can turn",
    description:
      "Show a real opponent, scoring rules, and the start or sit decision that matters most.",
  },
] as const;

function GameFilmVariant() {
  return (
    <>
      <section className="border-b px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Flaim Fantasy for football
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              See AI analyze your real fantasy football team
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Connect ESPN, Yahoo, or Sleeper, then ask ChatGPT or Claude about
              your roster, matchup, standings, waiver wire, trades, and league
              history.
            </p>
            <div className="mx-auto mt-7 flex justify-center">
              <FootballConnectionButtons />
            </div>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
            <FootballMediaShowcase />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
              <FutureClip
                compact
                label="Future phone clip"
                title="Draft grade in ChatGPT"
                description="A short screen recording can replace this slot without changing the layout."
              />
              <FutureClip
                compact
                label="Future phone clip"
                title="Waiver answer in Claude"
                description="A second clip can show an available player matched to a real roster need."
              />
            </div>
          </div>
        </div>
      </section>

      <section className="border-b bg-muted/40 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Three proof moments
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              Show the questions fantasy managers already ask
            </h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              Each slot is ready for an 8 to 12 second iPhone recording with a
              clear tap marker and one useful answer.
            </p>
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {FILM_SCENES.map((scene) => (
              <FutureClip
                key={scene.label}
                label={scene.label}
                title={scene.title}
                description={scene.description}
              />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

const ANSWER_INGREDIENTS = [
  "Your roster",
  "Scoring rules",
  "League standings",
  "Available players",
] as const;

const ANSWER_EXAMPLES = [
  {
    question: "How good is the team I drafted?",
    title: "A roster grade that knows the league",
    body: "Flaim brings your roster, scoring, league size, and the other teams into the answer.",
    clip: "Draft grade clip",
  },
  {
    question: "Who should I add before Week 1?",
    title: "Waiver advice from your available players",
    body: "The answer starts with who is actually unrostered, then compares those players with your needs.",
    clip: "Waiver wire clip",
  },
  {
    question: "What could decide this week's matchup?",
    title: "Start or sit help for your actual opponent",
    body: "Your lineup, opponent, scoring, and matchup all stay in the same conversation.",
    clip: "Matchup clip",
  },
] as const;

function InsideAnswerVariant() {
  return (
    <>
      <section className="border-b px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Your league inside your AI
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Ask AI about the fantasy football team you actually drafted
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Flaim connects ESPN, Yahoo, or Sleeper to ChatGPT and Claude, so
              the answer can include your roster, scoring, matchup, standings,
              available players, and league history.
            </p>
            <p className="mt-4 leading-7 text-muted-foreground">
              No screenshots. No typing every player. Just ask the question.
            </p>
            <div className="mt-7">
              <FootballConnectionButtons />
            </div>
          </div>

          <ImageProof
            src="/media/football/claude-football-standings-2026.png"
            alt="Claude using Flaim to answer a question about standings from a connected fantasy football league."
            label="Real connected answer"
            title="Claude checking an actual football league"
            description="The final page can rotate this proof with equivalent ChatGPT and Perplexity phone clips."
            aspectClassName="aspect-[16/10]"
            priority
          />
        </div>
      </section>

      <section className="border-b bg-muted/40 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Inside the answer
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              One question. Your whole league behind it.
            </h2>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_auto_1.2fr_auto_1fr] lg:items-center">
            <div className="rounded-2xl border bg-background p-5 shadow-sm">
              <MessageCircleQuestion
                className="h-6 w-6 text-primary"
                aria-hidden="true"
              />
              <p className="mt-4 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                You ask
              </p>
              <p className="mt-2 text-lg font-semibold">
                Who is the best player I can add at wide receiver?
              </p>
            </div>

            <ArrowRight
              className="mx-auto hidden h-5 w-5 text-muted-foreground lg:block"
              aria-hidden="true"
            />

            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
              <Search className="h-6 w-6 text-primary" aria-hidden="true" />
              <p className="mt-4 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Flaim brings
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {ANSWER_INGREDIENTS.map((ingredient) => (
                  <span
                    key={ingredient}
                    className="rounded-full border bg-background px-3 py-1.5 text-sm"
                  >
                    {ingredient}
                  </span>
                ))}
              </div>
            </div>

            <ArrowRight
              className="mx-auto hidden h-5 w-5 text-muted-foreground lg:block"
              aria-hidden="true"
            />

            <div className="rounded-2xl border bg-foreground p-5 text-background shadow-sm">
              <Sparkles className="h-6 w-6" aria-hidden="true" />
              <p className="mt-4 text-sm font-semibold uppercase tracking-[0.12em] text-background/65">
                Your AI answers
              </p>
              <p className="mt-2 text-lg font-semibold">
                A recommendation based on your team and your league.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight">
              See three real football questions answered
            </h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              These scenes can become short phone recordings later. The words
              around them stay visible and searchable.
            </p>
          </div>
          <div className="mt-8 space-y-6">
            {ANSWER_EXAMPLES.map((example, index) => (
              <article
                key={example.question}
                className="grid gap-5 rounded-[2rem] border bg-card p-5 md:grid-cols-[0.8fr_1.2fr] md:items-center md:p-7"
              >
                <div className={index % 2 === 1 ? "md:order-2" : undefined}>
                  <p className="text-sm font-medium text-primary">
                    &ldquo;{example.question}&rdquo;
                  </p>
                  <h3 className="mt-3 text-2xl font-semibold tracking-tight">
                    {example.title}
                  </h3>
                  <p className="mt-3 leading-7 text-muted-foreground">
                    {example.body}
                  </p>
                </div>
                <div className={index % 2 === 1 ? "md:order-1" : undefined}>
                  <FutureClip
                    compact
                    label="Future phone clip"
                    title={example.clip}
                    description="Replace this placeholder with a sanitized screen recording when it is ready."
                  />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

const SEASON_MOMENTS = [
  {
    label: "Draft night",
    question: "Grade the team I drafted.",
    body: "Your roster, scoring rules, league size, and positional depth.",
    media: "leagues",
  },
  {
    label: "Opening week",
    question: "Who should I start?",
    body: "Your lineup, opponent, scoring, and matchup.",
    media: "standings",
  },
  {
    label: "Waiver Tuesday",
    question: "Who can actually help my team?",
    body: "Your roster needs, available players, and recent league moves.",
    media: "future",
  },
  {
    label: "Trade season",
    question: "Does this deal make me better?",
    body: "Both rosters, standings, league rules, and positional depth.",
    media: "future",
  },
  {
    label: "Playoff push",
    question: "What needs to go right?",
    body: "Standings, upcoming matchups, roster health, and league history.",
    media: "future",
  },
] as const;

function SeasonMomentMedia({
  media,
  label,
}: {
  media: (typeof SEASON_MOMENTS)[number]["media"];
  label: string;
}) {
  if (media === "leagues") {
    return (
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-muted">
        <Image
          src="/media/football/connected-leagues-widget-2026.png"
          alt="Connected ESPN, Yahoo, and Sleeper fantasy football leagues in Flaim."
          fill
          sizes="18rem"
          className="object-cover object-top"
        />
      </div>
    );
  }

  if (media === "standings") {
    return (
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-muted">
        <Image
          src="/media/football/claude-football-standings-2026.png"
          alt="Claude checking standings from a connected fantasy football league through Flaim."
          fill
          sizes="18rem"
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <div className="flex aspect-[4/5] items-center justify-center rounded-2xl border border-dashed bg-gradient-to-br from-primary/10 to-muted p-5 text-center">
      <div>
        <CirclePlay className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
        <p className="mt-4 text-sm font-semibold">{label} phone clip</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Future 8 to 12 second recording
        </p>
      </div>
    </div>
  );
}

function SeasonStoryVariant() {
  return (
    <>
      <section className="border-b px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="max-w-4xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Draft night through the playoffs
              </p>
              <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                Your real fantasy football league, all season long
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
                Connect ESPN, Yahoo, or Sleeper once. Then ask ChatGPT or Claude
                about the team you drafted, weekly matchups, available players,
                trades, standings, and league history.
              </p>
            </div>
            <div className="lg:w-[22rem]">
              <FootballConnectionButtons />
            </div>
          </div>
        </div>
      </section>

      <section className="border-b bg-muted/40 py-14">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-6xl items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                A season in five moments
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight">
                The questions change. Your league stays connected.
              </h2>
            </div>
            <Film className="hidden h-9 w-9 text-primary sm:block" aria-hidden="true" />
          </div>
        </div>

        <div
          className="mt-8 snap-x snap-mandatory overflow-x-auto px-4 pb-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6 lg:px-8"
          role="region"
          aria-label="Fantasy football season examples. Scroll horizontally to see every moment."
          tabIndex={0}
        >
          <ol className="mx-auto flex w-max max-w-none gap-5">
            {SEASON_MOMENTS.map((moment, index) => (
              <li
                key={moment.label}
                className="w-[18rem] shrink-0 snap-start rounded-[1.75rem] border bg-background p-4 shadow-sm"
              >
                <SeasonMomentMedia media={moment.media} label={moment.label} />
                <div className="pt-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                      {index + 1}
                    </span>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {moment.label}
                    </p>
                  </div>
                  <h3 className="mt-4 text-xl font-semibold tracking-tight">
                    &ldquo;{moment.question}&rdquo;
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {moment.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-8 rounded-[2rem] border bg-card p-6 md:grid-cols-[0.85fr_1.15fr] md:items-center md:p-9">
          <div>
            <Trophy className="h-8 w-8 text-primary" aria-hidden="true" />
            <h2 className="mt-5 text-3xl font-bold tracking-tight">
              More than a draft grade
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Flaim stays useful after the draft. Ask about start or sit calls,
              waivers, trades, weekly matchups, standings, recent moves, and
              what happened in past seasons.
            </p>
            <Link
              href="/#live-demo"
              className="mt-5 inline-flex items-center text-sm font-medium text-primary hover:underline"
            >
              Explore the live demo
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <FutureClip
            compact
            label="Future season recap clip"
            title="Show the league changing over time"
            description="A final phone recording can demonstrate standings, recent moves, and the playoff picture in one answer."
          />
        </div>
      </section>
    </>
  );
}

export function FootballSeasonalVariant({
  variant,
}: {
  variant: FootballVariantId;
}) {
  if (variant === "game-film") {
    return <GameFilmVariant />;
  }

  if (variant === "season-story") {
    return <SeasonStoryVariant />;
  }

  return <InsideAnswerVariant />;
}
