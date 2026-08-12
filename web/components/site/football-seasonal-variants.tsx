import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CirclePlay,
  MessageCircleQuestion,
  Search,
  Sparkles,
  Trophy,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CHATGPT_APP_URL,
  CLAUDE_CONNECTOR_DIRECTORY_URL,
} from "@/lib/product-links";

export const FOOTBALL_VARIANTS = [
  {
    id: "season-chapters",
    label: "Season Chapters",
    description: "Clean editorial",
  },
  {
    id: "question-journey",
    label: "Question Journey",
    description: "Conversation-led",
  },
  {
    id: "season-timeline",
    label: "Season Timeline",
    description: "Visual progression",
  },
] as const;

export type FootballVariantId = (typeof FOOTBALL_VARIANTS)[number]["id"];

export const DEFAULT_FOOTBALL_VARIANT: FootballVariantId = "season-chapters";

export const FOOTBALL_CONTRAST_VARIANTS = [
  {
    id: "no-more-grid",
    label: "No More Grid",
    description: "Clean statements",
  },
  {
    id: "crossed-out",
    label: "Crossed Out",
    description: "Bold checklist",
  },
  {
    id: "before-after",
    label: "Before and After",
    description: "Clear comparison",
  },
  {
    id: "manifesto",
    label: "Manifesto",
    description: "One big thought",
  },
] as const;

export type FootballContrastVariantId =
  (typeof FOOTBALL_CONTRAST_VARIANTS)[number]["id"];

export const DEFAULT_FOOTBALL_CONTRAST_VARIANT: FootballContrastVariantId =
  "no-more-grid";

export function isFootballVariant(value: string): value is FootballVariantId {
  return FOOTBALL_VARIANTS.some((variant) => variant.id === value);
}

export function isFootballContrastVariant(
  value: string,
): value is FootballContrastVariantId {
  return FOOTBALL_CONTRAST_VARIANTS.some((variant) => variant.id === value);
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
            Seasonal page lab, round two
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Three alternating season-story directions. Choose one to compare the
            full page.
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
  primaryLabel = "First Connect Your Leagues",
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
          Add ChatGPT Plugin
        </a>
      </Button>
      <Button asChild size="lg" variant="outline" className="w-full">
        <a
          href={CLAUDE_CONNECTOR_DIRECTORY_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Add Claude Plugin
        </a>
      </Button>
    </div>
  );
}

const SEASON_MOMENTS = [
  {
    id: "draft-night",
    label: "Draft night",
    question: "Grade the team I drafted.",
    title: "A roster grade that knows the league",
    description:
      "Flaim brings your actual roster, scoring rules, league size, and positional depth into the answer. You get more than a generic list of player rankings.",
    ingredients: ["Your roster", "Scoring rules", "League size"],
    media: "future",
  },
  {
    id: "waiver-tuesday",
    label: "Waiver Tuesday",
    question: "Who can actually help my team?",
    title: "Waiver advice from players you can add",
    description:
      "Start with your roster needs and the players still available in your league. Then compare the best additions without typing out your team.",
    ingredients: ["Roster needs", "Available players", "Recent moves"],
    media: "future",
  },
  {
    id: "weekly-matchup",
    label: "Weekly matchup",
    question: "What could decide this week?",
    title: "Start or sit help for your actual opponent",
    description:
      "Your lineup, opponent, scoring rules, and matchup stay together, so the answer can focus on the decisions that matter this week.",
    ingredients: ["Your lineup", "Your opponent", "League scoring"],
    media: "future",
  },
  {
    id: "playoff-push",
    label: "Playoff push",
    question: "What does my path to the playoffs look like?",
    title: "See where your team stands across the league",
    description:
      "Use standings, upcoming matchups, recent moves, and league history to understand what needs to go right down the stretch.",
    ingredients: ["Standings", "Upcoming matchups", "League history"],
    media: "standings",
  },
] as const;

const EXPLANATION_TO_SKIP = [
  "No roster screenshots",
  "No copy and paste",
  "No retyping your whole team",
  "No AI guessing your league rules",
  "No forgetting who is on your roster",
  "No answers for the wrong week",
] as const;

const WITHOUT_FLAIM = [
  "Upload roster screenshots",
  "Copy and paste player lists",
  "Explain your league rules again",
  "Rebuild your league in every chat",
] as const;

const WITH_FLAIM = [
  "Ask the next question",
  "Bring your real roster",
  "Include your league rules",
  "Use the right week and season",
] as const;

type SeasonMoment = (typeof SEASON_MOMENTS)[number];

function IngredientPills({ ingredients }: { ingredients: readonly string[] }) {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {ingredients.map((ingredient) => (
        <span
          key={ingredient}
          className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground"
        >
          {ingredient}
        </span>
      ))}
    </div>
  );
}

function FutureClip({ moment }: { moment: SeasonMoment }) {
  return (
    <div className="relative flex aspect-[16/11] overflow-hidden rounded-[2rem] border bg-gradient-to-br from-primary/10 via-background to-muted p-6 shadow-sm">
      <div className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full border bg-background/80 shadow-sm backdrop-blur">
        <CirclePlay className="h-5 w-5 text-primary" aria-hidden="true" />
      </div>
      <div className="mt-auto max-w-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Future phone clip
        </p>
        <p className="mt-2 text-lg font-semibold">{moment.label} in action</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          An 8 to 12 second sanitized recording can replace this staging
          placeholder once real 2026 league data is available.
        </p>
      </div>
    </div>
  );
}

function StandingsProof() {
  return (
    <figure className="overflow-hidden rounded-[2rem] border bg-card shadow-sm">
      <div className="relative aspect-[16/10] bg-muted">
        <Image
          src="/media/football/claude-football-standings-2026.png"
          alt="Claude using Flaim to retrieve standings from a connected fantasy football league."
          fill
          sizes="(min-width: 1024px) 46vw, (min-width: 640px) 80vw, 94vw"
          className="object-contain"
        />
      </div>
      <figcaption className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Real connected answer
        </p>
        <p className="mt-2 font-semibold">
          Claude checking an actual football league
        </p>
      </figcaption>
    </figure>
  );
}

function MomentMedia({ moment }: { moment: SeasonMoment }) {
  return moment.media === "standings" ? (
    <StandingsProof />
  ) : (
    <FutureClip moment={moment} />
  );
}

function ConnectedLeaguesProof() {
  return (
    <figure className="mx-auto w-full max-w-md overflow-hidden rounded-[2rem] border bg-card shadow-xl shadow-foreground/5">
      <div className="relative aspect-[4/5] bg-muted/50">
        <Image
          src="/media/football/connected-leagues-widget-2026.png"
          alt="Flaim showing connected ESPN, Yahoo, and Sleeper fantasy football leagues."
          fill
          priority
          sizes="(min-width: 1024px) 36vw, (min-width: 640px) 65vw, 92vw"
          className="object-cover object-top"
        />
      </div>
      <figcaption className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Connect once
        </p>
        <p className="mt-2 font-semibold">
          Your football leagues, ready in one place
        </p>
      </figcaption>
    </figure>
  );
}

function ContrastVariantSwitcher({
  activeVariant,
}: {
  activeVariant: FootballContrastVariantId;
}) {
  return (
    <aside className="border-b border-background/15 pb-7">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-background/55">
        Dark section lab
      </p>
      <nav
        className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4"
        aria-label="Choose a dark section variant"
      >
        {FOOTBALL_CONTRAST_VARIANTS.map((variant) => {
          const isActive = variant.id === activeVariant;

          return (
            <Link
              key={variant.id}
              href={`/fantasy-football?variant=season-chapters&contrast=${variant.id}`}
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              className={`rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background ${
                isActive
                  ? "border-background bg-background text-foreground"
                  : "border-background/20 text-background hover:border-background/50"
              }`}
            >
              <span className="block text-sm font-semibold">
                {variant.label}
              </span>
              <span
                className={`mt-0.5 block text-xs ${
                  isActive ? "text-muted-foreground" : "text-background/55"
                }`}
              >
                {variant.description}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function NoMoreGrid() {
  return (
    <>
      <div className="max-w-3xl">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Less explaining. More fantasy football.
        </h2>
        <p className="mt-4 text-lg leading-8 text-background/70">
          Connect once and let Flaim bring the league details that generic AI
          would otherwise miss.
        </p>
      </div>
      <ul className="mt-9 grid gap-px overflow-hidden rounded-[2rem] border border-background/15 bg-background/15 sm:grid-cols-2 lg:grid-cols-3">
        {EXPLANATION_TO_SKIP.map((item) => (
          <li
            key={item}
            className="bg-foreground px-6 py-7 text-lg font-semibold tracking-tight"
          >
            {item}
          </li>
        ))}
      </ul>
    </>
  );
}

function CrossedOutList() {
  return (
    <div className="grid gap-9 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-background/55">
          Leave the busywork behind
        </p>
        <h2 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
          Your league should not need an introduction every time.
        </h2>
      </div>
      <ul className="divide-y divide-background/15 border-y border-background/15">
        {EXPLANATION_TO_SKIP.map((item, index) => (
          <li key={item} className="flex items-center gap-5 py-5">
            <span className="text-sm font-semibold tabular-nums text-background/35">
              0{index + 1}
            </span>
            <span className="text-xl font-semibold tracking-tight text-background/45 line-through decoration-background/30 decoration-2">
              {item.replace(/^No /, "")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BeforeAfterComparison() {
  return (
    <>
      <div className="max-w-3xl">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Same AI. Way less work.
        </h2>
        <p className="mt-4 text-lg leading-8 text-background/70">
          Flaim keeps your actual fantasy league ready for the next question.
        </p>
      </div>
      <div className="mt-9 grid overflow-hidden rounded-[2rem] border border-background/15 md:grid-cols-2">
        <div className="border-b border-background/15 p-6 md:border-b-0 md:border-r sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-background/45">
            Without Flaim
          </p>
          <ul className="mt-6 space-y-4 text-lg text-background/55">
            {WITHOUT_FLAIM.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="bg-background p-6 text-foreground sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            With Flaim
          </p>
          <ul className="mt-6 space-y-4 text-lg font-semibold">
            {WITH_FLAIM.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function ManifestoStatement() {
  return (
    <div className="max-w-5xl py-2">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-background/55">
        Your league comes with you
      </p>
      <h2 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
        No screenshots. No copy and paste. No rebuilding your roster. No AI
        guessing your rules. Just your actual league, ready when you ask.
      </h2>
    </div>
  );
}

function LessExplainingSection({
  variant,
  showVariantLab,
}: {
  variant: FootballContrastVariantId;
  showVariantLab: boolean;
}) {
  return (
    <section className="border-b bg-foreground px-4 py-14 text-background sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        {showVariantLab ? (
          <div className="mb-10">
            <ContrastVariantSwitcher activeVariant={variant} />
          </div>
        ) : null}

        {variant === "crossed-out" ? <CrossedOutList /> : null}
        {variant === "before-after" ? <BeforeAfterComparison /> : null}
        {variant === "manifesto" ? <ManifestoStatement /> : null}
        {variant === "no-more-grid" ? <NoMoreGrid /> : null}
      </div>
    </section>
  );
}

function SeasonChaptersVariant({
  contrastVariant,
  showContrastVariantLab,
}: {
  contrastVariant: FootballContrastVariantId;
  showContrastVariantLab: boolean;
}) {
  return (
    <>
      <section className="border-b px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Your leagues, all season long
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Add your team to your AI
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Connect ESPN, Yahoo, or Sleeper to Flaim once. Then, connect Flaim
              to ChatGPT or Claude and you&apos;re done.
            </p>
            <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
              Ask about the team you drafted, weekly matchups, available
              players, standings, trades, and league history.
            </p>
            <div className="mt-7">
              <FootballConnectionButtons />
            </div>
          </div>
          <ConnectedLeaguesProof />
        </div>
      </section>

      <section className="border-b px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              It&apos;s so much nicer this way...
            </h2>
          </div>

          <div className="mt-12 space-y-14 lg:space-y-20">
            {SEASON_MOMENTS.map((moment, index) => (
              <article
                key={moment.id}
                className="grid gap-7 md:grid-cols-2 md:items-center lg:gap-12"
              >
                <div className={index % 2 === 1 ? "md:order-2" : undefined}>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    {moment.label}
                  </p>
                  <p className="mt-4 text-sm font-medium text-muted-foreground">
                    &ldquo;{moment.question}&rdquo;
                  </p>
                  <p className="mt-4 leading-7 text-muted-foreground">
                    {moment.description}
                  </p>
                  <IngredientPills ingredients={moment.ingredients} />
                </div>
                <div className={index % 2 === 1 ? "md:order-1" : undefined}>
                  <MomentMedia moment={moment} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <LessExplainingSection
        variant={contrastVariant}
        showVariantLab={showContrastVariantLab}
      />
    </>
  );
}

function QuestionJourneyHero() {
  return (
    <section className="border-b px-4 py-12 sm:px-6 md:py-16 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Ask about the team you actually manage
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Ask one fantasy football question. Bring your whole league.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Flaim connects ESPN, Yahoo, or Sleeper to ChatGPT and Claude, so
            every answer can start with your roster, matchup, standings,
            available players, recent moves, and league rules.
          </p>
          <p className="mt-4 leading-7 text-muted-foreground">
            No screenshots. No typing every player. Just ask the question.
          </p>
          <div className="mt-7">
            <FootballConnectionButtons />
          </div>
        </div>

        <div className="rounded-[2rem] border bg-muted/40 p-5 shadow-sm sm:p-7">
          <div className="ml-auto max-w-md rounded-[1.5rem] bg-foreground p-5 text-background">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-background/60">
              You ask
            </p>
            <p className="mt-2 text-lg font-semibold">
              How good is the team I just drafted?
            </p>
          </div>
          <div className="my-4 flex justify-center">
            <ArrowRight
              className="h-5 w-5 rotate-90 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <div className="max-w-md rounded-[1.5rem] border bg-background p-5">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
              <p className="text-xs font-semibold uppercase tracking-[0.14em]">
                Flaim brings your league
              </p>
            </div>
            <p className="mt-3 leading-7 text-muted-foreground">
              Your roster, scoring rules, league size, standings, and every
              other team.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function QuestionJourneyVariant() {
  return (
    <>
      <QuestionJourneyHero />

      <section className="border-b bg-muted/35 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              The questions change with the season
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              See what goes into each answer
            </h2>
          </div>

          <div className="mt-12 space-y-14 lg:space-y-20">
            {SEASON_MOMENTS.map((moment, index) => (
              <article
                key={moment.id}
                className="grid gap-7 md:grid-cols-2 md:items-center lg:gap-12"
              >
                <div className={index % 2 === 1 ? "md:order-2" : undefined}>
                  <div className="rounded-[1.5rem] bg-foreground p-5 text-background shadow-sm">
                    <div className="flex items-center gap-2 text-background/65">
                      <MessageCircleQuestion
                        className="h-5 w-5"
                        aria-hidden="true"
                      />
                      <p className="text-xs font-semibold uppercase tracking-[0.14em]">
                        {moment.label}
                      </p>
                    </div>
                    <p className="mt-3 text-xl font-semibold">
                      &ldquo;{moment.question}&rdquo;
                    </p>
                  </div>

                  <div className="mt-4 rounded-[1.5rem] border border-primary/25 bg-primary/5 p-5">
                    <div className="flex items-center gap-2 text-primary">
                      <Search className="h-5 w-5" aria-hidden="true" />
                      <p className="text-xs font-semibold uppercase tracking-[0.14em]">
                        Flaim brings
                      </p>
                    </div>
                    <IngredientPills ingredients={moment.ingredients} />
                  </div>

                  <h3 className="mt-6 text-3xl font-bold tracking-tight">
                    {moment.title}
                  </h3>
                  <p className="mt-4 leading-7 text-muted-foreground">
                    {moment.description}
                  </p>
                </div>
                <div className={index % 2 === 1 ? "md:order-1" : undefined}>
                  <MomentMedia moment={moment} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function TimelineHero() {
  return (
    <section className="border-b px-4 py-12 sm:px-6 md:py-16 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_0.8fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Draft night through the playoff push
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Keep your real fantasy football league connected all season
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
            Ask ChatGPT or Claude about the next decision without explaining
            your ESPN, Yahoo, or Sleeper league again.
          </p>
          <div className="mt-7">
            <FootballConnectionButtons />
          </div>
        </div>

        <div className="rounded-[2rem] border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-6 w-6 text-primary" aria-hidden="true" />
            <p className="font-semibold">One connection for the whole season</p>
          </div>
          <ol className="mt-6 space-y-4">
            {SEASON_MOMENTS.map((moment, index) => (
              <li key={moment.id} className="flex items-center gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {index + 1}
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {moment.label}
                  </p>
                  <p className="mt-1 text-sm font-medium">{moment.question}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function SeasonTimelineVariant() {
  return (
    <>
      <TimelineHero />

      <section className="border-b bg-muted/35 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              A season in four moments
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              Your questions move forward. Your league stays with you.
            </h2>
          </div>

          <div className="relative mt-14 space-y-14 md:space-y-20">
            <div
              className="absolute bottom-0 left-1/2 top-0 hidden w-px -translate-x-1/2 bg-border md:block"
              aria-hidden="true"
            />

            {SEASON_MOMENTS.map((moment, index) => {
              const textFirst = index % 2 === 0;

              return (
                <article
                  key={moment.id}
                  className="relative grid gap-7 md:grid-cols-2 md:items-center md:gap-14 lg:gap-20"
                >
                  <div
                    className={`absolute left-1/2 top-1/2 z-10 hidden h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-sm font-bold shadow-sm md:flex ${
                      textFirst ? "text-primary" : "text-foreground"
                    }`}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </div>

                  <div className={textFirst ? undefined : "md:order-2"}>
                    <div className="rounded-[1.75rem] border bg-background p-6 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                        {moment.label}
                      </p>
                      <p className="mt-4 text-sm font-medium text-muted-foreground">
                        &ldquo;{moment.question}&rdquo;
                      </p>
                      <h3 className="mt-3 text-2xl font-bold tracking-tight">
                        {moment.title}
                      </h3>
                      <p className="mt-4 leading-7 text-muted-foreground">
                        {moment.description}
                      </p>
                      <IngredientPills ingredients={moment.ingredients} />
                    </div>
                  </div>

                  <div className={textFirst ? undefined : "md:order-1"}>
                    <MomentMedia moment={moment} />
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mx-auto mt-14 max-w-2xl rounded-[2rem] border bg-background p-7 text-center shadow-sm">
            <Trophy className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
            <h2 className="mt-5 text-2xl font-bold tracking-tight">
              More than a draft grade
            </h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              Use the same connection for waivers, start or sit calls, trades,
              weekly matchups, standings, recent moves, and league history.
            </p>
            <Link
              href="/#live-demo"
              className="mt-5 inline-flex items-center text-sm font-medium text-primary hover:underline"
            >
              Explore the live demo
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

export function FootballSeasonalVariant({
  variant,
  contrastVariant,
  showContrastVariantLab,
}: {
  variant: FootballVariantId;
  contrastVariant: FootballContrastVariantId;
  showContrastVariantLab: boolean;
}) {
  if (variant === "question-journey") {
    return <QuestionJourneyVariant />;
  }

  if (variant === "season-timeline") {
    return <SeasonTimelineVariant />;
  }

  return (
    <SeasonChaptersVariant
      contrastVariant={contrastVariant}
      showContrastVariantLab={showContrastVariantLab}
    />
  );
}
